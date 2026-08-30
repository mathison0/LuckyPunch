// 벽(사이드) 관련 허점 계측 — 플랜의 G1/G2 검증용.
//
// 랠리별 태그:
//   cornerRecv : 대상 봇이 지상(state 0)에서 코너 대역(LEFT x<44 / RIGHT x>388)의
//                공을 몸으로 받은 랠리 — G1 (네트쪽 면 수신 불가 → 벽 반사 로브 체인)
//   shotWall   : 대상 봇의 파워히트 직후 궤적에 벽 반사가 포함된 랠리 — G2
//   anyWall    : 어느 쪽이든 실제 벽 반사가 일어난 랠리
//
// 사용법: node wall-audit.mjs [봇파일=LuckyPunch_v7.js] [시드수=12]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBot, makeRng } from './arena.mjs';
import { setCustomRng } from './rand.mjs';
import { PikaPhysics, PikaUserInput } from './physics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(HERE, '..', 'src', 'code-here') + '/';

const TICK = 3;
const NET = 216;
const G = 432;
const FROZEN_AFTER = 5, FROZEN_READY = 30, FROZEN_FIRST = 71;

function runSet(meFile, oppSpec, seed, jit, meLeft, agg) {
  const rng = makeRng(seed);
  setCustomRng(rng);
  const me = loadBot(D + meFile, null);
  const op = oppSpec === 'ai' ? null : loadBot(D + oppSpec, null);
  const decides = meLeft ? [me, op] : [op, me];
  const physics = new PikaPhysics(decides[0] === null, decides[1] === null);
  const inputs = [new PikaUserInput(), new PikaUserInput()];
  const scores = [0, 0];
  const myIdx = meLeft ? 0 : 1;
  let isP2Serve = rng() < 0.5;
  let frame = 0, firstRound = true;
  const latest = [{ x: 0, y: 0, hit: 0 }, { x: 0, y: 0, hit: 0 }];
  const pending = [null, null];
  const ticks = [0, 0];

  function getInput(i) {
    if (decides[i] === null) return;
    if (pending[i] && frame >= pending[i].readyAt) { latest[i] = pending[i].action; pending[i] = null; }
    inputs[i].xDirection = latest[i].x; inputs[i].yDirection = latest[i].y; inputs[i].powerHit = latest[i].hit;
    ticks[i]++;
    if (ticks[i] % TICK !== 0 || pending[i]) return;
    const isP2 = i === 1;
    const self = isP2 ? physics.player2 : physics.player1;
    const opp = isP2 ? physics.player1 : physics.player2;
    const b = physics.ball;
    const snap = {
      tick: ticks[i], side: isP2 ? 'RIGHT' : 'LEFT',
      self: { x: self.x, y: self.y, state: self.state, frameNumber: self.frameNumber, divingDirection: self.divingDirection },
      opp: { x: opp.x, y: opp.y, state: opp.state, frameNumber: opp.frameNumber, divingDirection: opp.divingDirection },
      ball: { x: b.x, y: b.y, xVelocity: b.xVelocity, yVelocity: b.yVelocity, isPowerHit: b.isPowerHit, expectedLandingPointX: b.expectedLandingPointX },
      meta: { score: { self: scores[isP2 ? 1 : 0], opp: scores[isP2 ? 0 : 1] }, isPlayer2Serve: isP2Serve, rallyFrameCount: 0 },
      config: { tickFrameGroupSize: TICK },
    };
    let a; try { a = decides[i](snap); } catch (e) { a = { x: 0, y: 0, hit: 0 }; }
    if (!a || typeof a !== 'object' || ![-1, 0, 1].includes(a.x) || ![-1, 0, 1].includes(a.y) || ![0, 1].includes(a.hit)) a = { x: 0, y: 0, hit: 0 };
    pending[i] = { action: a, readyAt: frame + 1 };
  }

  while (scores[0] < 10 && scores[1] < 10) {
    if (!firstRound) for (let i = 0; i < FROZEN_AFTER; i++) { getInput(0); getInput(1); frame++; }
    physics.player1.initializeForNewRound();
    physics.player2.initializeForNewRound();
    physics.ball.initializeForNewRound(isP2Serve);
    if (jit > 0) {
      const j = () => Math.round((rng() * 2 - 1) * jit);
      physics.ball.x += j();
      physics.player1.x = Math.max(32, Math.min(184, physics.player1.x + j()));
      physics.player2.x = Math.max(248, Math.min(400, physics.player2.x + j()));
    }
    const frozen = firstRound ? FROZEN_FIRST : FROZEN_READY;
    firstRound = false;
    for (let i = 0; i < frozen; i++) { getInput(0); getInput(1); frame++; }

    // 랠리 태그 상태
    let cornerRecv = false, shotWall = false, anyWall = false, meTouched = false;
    let watchShotFrames = 0; // 내 파워히트 후 벽 반사 감시 창
    const prevCol = [false, false];
    let rf = 0, loser = -1;
    const touches = [0, 0]; let prevOnLeft = null;

    while (true) {
      getInput(0); getInput(1);
      // 벽 반사 감지: 엔진과 같은 조건을 스텝 직전에 평가
      const willBounce = physics.ball.x + physics.ball.xVelocity < 0 || physics.ball.x + physics.ball.xVelocity > G;
      const g = physics.runEngineForNextFrame(inputs);
      frame++; rf++;
      if (willBounce) { anyWall = true; if (watchShotFrames > 0) shotWall = true; }
      if (watchShotFrames > 0) watchShotFrames--;

      // 접촉 이벤트
      const players = [physics.player1, physics.player2];
      const onLeft = physics.ball.x < NET;
      if (prevOnLeft !== null && onLeft !== prevOnLeft) { touches[0] = 0; touches[1] = 0; }
      prevOnLeft = onLeft;
      for (let i = 0; i < 2; i++) {
        const col = players[i].isCollisionWithBallHappened;
        if (col && !prevCol[i]) {
          watchShotFrames = 0; // 새 접촉 = 이전 슛의 비행 종료 (감시 정밀화)
          touches[i]++;
          if (touches[i] >= 5) loser = i;
          if (i === myIdx) {
            meTouched = true;
            const bx = physics.ball.x;
            const corner = meLeft ? bx < 44 : bx > G - 44;
            if (players[i].state === 0 && corner) cornerRecv = true;
            if (players[i].state === 2) watchShotFrames = 60; // 파워히트 → 벽 감시
          }
        }
        prevCol[i] = col;
      }
      if (loser >= 0) { scores[loser === 0 ? 1 : 0]++; break; }
      if (g) { const w = physics.ball.punchEffectX < NET ? 1 : 0; scores[w]++; loser = w === 0 ? 1 : 0; break; }
      if (rf > 4000) { loser = -2; break; }
    }
    const iWon = loser >= 0 && loser !== myIdx;
    agg.rallies++;
    if (iWon) agg.wins++;
    if (cornerRecv) { agg.cornerR++; if (iWon) agg.cornerW++; }
    else if (meTouched) { agg.normalR++; if (iWon) agg.normalW++; }
    if (shotWall) { agg.shotWallR++; if (iWon) agg.shotWallW++; }
    if (anyWall) { agg.anyWallR++; if (iWon) agg.anyWallW++; }
    isP2Serve = rng() < 0.5;
  }
  if (scores[meLeft ? 0 : 1] > scores[meLeft ? 1 : 0]) agg.setWins++;
  agg.sets++;
}

const meFile = process.argv[2] || 'LuckyPunch_v7.js';
const seeds = Number(process.argv[3] || 12);
const agg = { sets: 0, setWins: 0, rallies: 0, wins: 0, cornerR: 0, cornerW: 0, normalR: 0, normalW: 0, shotWallR: 0, shotWallW: 0, anyWallR: 0, anyWallW: 0 };

for (const opp of ['ai', 'LuckyPunch_v3.js', 'LuckyPunch_v5.js']) {
  for (let i = 0; i < seeds; i++) {
    for (const jit of [0, 8]) {
      for (const L of [true, false]) {
        runSet(meFile, opp, 51000 + i * 7919, jit, L, agg);
      }
    }
  }
}

const pct = (w, n) => (n ? ((w / n) * 100).toFixed(1) + '%' : '—');
console.log(`${meFile} 벽 감사 (${agg.sets}세트, 상대: ai·v3·v5)`);
console.log(`  세트 승률          : ${pct(agg.setWins, agg.sets)}`);
console.log(`  전체 랠리 승률      : ${pct(agg.wins, agg.rallies)}  (${agg.rallies}랠리)`);
console.log(`  [G1] 코너 몸통수신  : ${pct(agg.cornerW, agg.cornerR)}  (${agg.cornerR}랠리)`);
console.log(`       일반 수신 대조  : ${pct(agg.normalW, agg.normalR)}  (${agg.normalR}랠리)`);
console.log(`  [G2] 벽반사 포함 내슛: ${pct(agg.shotWallW, agg.shotWallR)}  (${agg.shotWallR}랠리)`);
console.log(`  참고: 벽반사 발생 랠리: ${pct(agg.anyWallW, agg.anyWallR)}  (${agg.anyWallR}랠리)`);
