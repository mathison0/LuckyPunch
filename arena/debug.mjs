// 한 랠리를 프레임 단위로 찍어본다.
// 사용법: node debug.mjs <봇파일> <rallies> [serve: left|right] [applyLag]
import path from 'node:path';
import { PikaPhysics, PikaUserInput } from './physics.mjs';
import { setCustomRng } from './rand.mjs';
import { loadBot, makeRng } from './arena.mjs';
import { fileURLToPath } from 'node:url';
// 저장소 어디서 실행해도 동작하도록 이 스크립트 위치 기준으로 잡는다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const CODE_DIR = path.join(HERE, '..', 'src', 'code-here');
const TICK_GROUP = 3;
const NET_X = 216;

const [, , botArg, ralliesArg, serveArg, lagArg] = process.argv;
const file = path.join(CODE_DIR, botArg);
const rallies = Number(ralliesArg || 1);
const applyLag = Number(lagArg || 1);
const serveRight = (serveArg || 'left') === 'right';

setCustomRng(makeRng(12345));

const decides = [loadBot(file, null), loadBot(file, null)];
const physics = new PikaPhysics(false, false);
const inputs = [new PikaUserInput(), new PikaUserInput()];
const scores = [0, 0];

function snap(tick, side) {
  const isP2 = side === 'RIGHT';
  const self = isP2 ? physics.player2 : physics.player1;
  const opp = isP2 ? physics.player1 : physics.player2;
  const v = (p) => ({ x: p.x, y: p.y, state: p.state, frameNumber: p.frameNumber, divingDirection: p.divingDirection });
  return {
    tick, side, self: v(self), opp: v(opp),
    ball: { x: physics.ball.x, y: physics.ball.y, xVelocity: physics.ball.xVelocity, yVelocity: physics.ball.yVelocity, isPowerHit: physics.ball.isPowerHit, expectedLandingPointX: physics.ball.expectedLandingPointX },
    meta: { score: { self: 0, opp: 0 }, isPlayer2Serve: serveRight, rallyFrameCount: tick },
    config: { tickFrameGroupSize: TICK_GROUP },
  };
}

for (let r = 0; r < rallies; r++) {
  physics.player1.initializeForNewRound();
  physics.player2.initializeForNewRound();
  physics.ball.initializeForNewRound(serveRight);
  const latest = [{ x: 0, y: 0, hit: 0 }, { x: 0, y: 0, hit: 0 }];
  const pending = [null, null];
  console.log(`\n=== 랠리 ${r + 1} (서브: ${serveRight ? 'RIGHT' : 'LEFT'}) ===`);
  console.log('frm | P1 x/y/st  in(x,y,h) | P2 x/y/st  in(x,y,h) | ball x,y  vx,vy  land');
  for (let f = 0; f < 160; f++) {
    for (let i = 0; i < 2; i++) {
      if (pending[i] && f >= pending[i].readyAt) { latest[i] = pending[i].action; pending[i] = null; }
      inputs[i].xDirection = latest[i].x;
      inputs[i].yDirection = latest[i].y;
      inputs[i].powerHit = latest[i].hit;
      if (f % TICK_GROUP === 0 && !pending[i]) {
        const a = decides[i](snap(f, i === 0 ? 'LEFT' : 'RIGHT'));
        pending[i] = { action: a, readyAt: f + applyLag };
      }
    }
    const p1 = physics.player1, p2 = physics.player2, b = physics.ball;
    console.log(
      String(f).padStart(3) + ' | ' +
      `${String(p1.x).padStart(3)}/${String(p1.y).padStart(3)}/${p1.state} (${inputs[0].xDirection},${inputs[0].yDirection},${inputs[0].powerHit})` + ' | ' +
      `${String(p2.x).padStart(3)}/${String(p2.y).padStart(3)}/${p2.state} (${inputs[1].xDirection},${inputs[1].yDirection},${inputs[1].powerHit})` + ' | ' +
      `${String(b.x).padStart(3)},${String(b.y).padStart(3)} ${String(b.xVelocity).padStart(4)},${String(b.yVelocity).padStart(3)} land=${b.expectedLandingPointX}`
    );
    const grounded = physics.runEngineForNextFrame(inputs);
    if (grounded) {
      const winner = physics.ball.punchEffectX < NET_X ? 'RIGHT' : 'LEFT';
      console.log(`  >>> 착지 x=${physics.ball.punchEffectX} → ${winner} 득점 (${f + 1}프레임)`);
      break;
    }
  }
}
