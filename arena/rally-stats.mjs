// 후보 봇의 상대별 "랠리" 승률 계측 (세트 승률과 별도)
// 프로토콜: lag1, 지터 {0,8}, 양 진영, 시드 12 → 상대당 48세트
// 사용법: node rally-stats.mjs [봇파일] [NAME=값,...] [상대파일,...]
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadBot, makeRng } from './arena.mjs';
import { setCustomRng } from './rand.mjs';
import { PikaPhysics, PikaUserInput } from './physics.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(HERE, '..', 'src', 'code-here') + '/';
const ME_OVERRIDES = process.argv[3]
  ? Object.fromEntries(
      process.argv[3].split(',').map((pair) => {
        const [name, value] = pair.split('=');
        return [name.trim(), Number(value)];
      })
    )
  : null;
const TICK = 3,
  NET = 216;
const FROZEN_AFTER = 5,
  FROZEN_READY = 30,
  FROZEN_FIRST = 71;

function runSet(meFile, oppFile, seed, jit, meLeft, agg) {
  const rng = makeRng(seed);
  setCustomRng(rng);
  const me = loadBot(D + meFile, ME_OVERRIDES);
  const op = loadBot(D + oppFile, null);
  const decides = meLeft ? [me, op] : [op, me];
  const physics = new PikaPhysics(false, false);
  const inputs = [new PikaUserInput(), new PikaUserInput()];
  const scores = [0, 0];
  const myIdx = meLeft ? 0 : 1;
  let isP2Serve = rng() < 0.5;
  let frame = 0,
    firstRound = true;
  const latest = [
    { x: 0, y: 0, hit: 0 },
    { x: 0, y: 0, hit: 0 },
  ];
  const pending = [null, null];
  const ticks = [0, 0];
  function getInput(i) {
    if (pending[i] && frame >= pending[i].readyAt) {
      latest[i] = pending[i].action;
      pending[i] = null;
    }
    inputs[i].xDirection = latest[i].x;
    inputs[i].yDirection = latest[i].y;
    inputs[i].powerHit = latest[i].hit;
    ticks[i]++;
    if (ticks[i] % TICK !== 0 || pending[i]) return;
    const isP2 = i === 1;
    const self = isP2 ? physics.player2 : physics.player1;
    const opp = isP2 ? physics.player1 : physics.player2;
    const b = physics.ball;
    const snap = {
      tick: ticks[i],
      side: isP2 ? 'RIGHT' : 'LEFT',
      self: {
        x: self.x,
        y: self.y,
        state: self.state,
        frameNumber: self.frameNumber,
        divingDirection: self.divingDirection,
      },
      opp: {
        x: opp.x,
        y: opp.y,
        state: opp.state,
        frameNumber: opp.frameNumber,
        divingDirection: opp.divingDirection,
      },
      ball: {
        x: b.x,
        y: b.y,
        xVelocity: b.xVelocity,
        yVelocity: b.yVelocity,
        isPowerHit: b.isPowerHit,
        expectedLandingPointX: b.expectedLandingPointX,
      },
      meta: {
        score: { self: scores[isP2 ? 1 : 0], opp: scores[isP2 ? 0 : 1] },
        isPlayer2Serve: isP2Serve,
        rallyFrameCount: 0,
      },
      config: { tickFrameGroupSize: TICK },
    };
    let a;
    try {
      const startedAt = i === myIdx ? performance.now() : 0;
      a = decides[i](snap);
      if (i === myIdx) {
        const elapsed = performance.now() - startedAt;
        agg.decisions++;
        agg.decideMs += elapsed;
        if (elapsed > agg.maxDecideMs) agg.maxDecideMs = elapsed;
      }
    } catch (e) {
      a = { x: 0, y: 0, hit: 0 };
    }
    if (
      !a ||
      typeof a !== 'object' ||
      ![-1, 0, 1].includes(a.x) ||
      ![-1, 0, 1].includes(a.y) ||
      ![0, 1].includes(a.hit)
    )
      a = { x: 0, y: 0, hit: 0 };
    pending[i] = { action: a, readyAt: frame + 1 };
  }
  while (scores[0] < 10 && scores[1] < 10) {
    if (!firstRound)
      for (let i = 0; i < FROZEN_AFTER; i++) {
        getInput(0);
        getInput(1);
        frame++;
      }
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
    for (let i = 0; i < frozen; i++) {
      getInput(0);
      getInput(1);
      frame++;
    }
    // 서브측 기록 (내가 서브인 랠리 / 리시브인 랠리 분해용)
    const meServes = (isP2Serve && myIdx === 1) || (!isP2Serve && myIdx === 0);
    const touches = [0, 0];
    const prevCol = [false, false];
    let prevOnLeft = null,
      rf = 0,
      loser = -1;
    while (true) {
      getInput(0);
      getInput(1);
      const g = physics.runEngineForNextFrame(inputs);
      frame++;
      rf++;
      const onLeft = physics.ball.x < NET;
      if (prevOnLeft !== null && onLeft !== prevOnLeft) {
        touches[0] = 0;
        touches[1] = 0;
      }
      prevOnLeft = onLeft;
      const players = [physics.player1, physics.player2];
      for (let i = 0; i < 2; i++) {
        const col = players[i].isCollisionWithBallHappened;
        if (col && !prevCol[i]) {
          touches[i]++;
          if (touches[i] >= 5) loser = i;
        }
        prevCol[i] = col;
      }
      if (loser >= 0) {
        scores[loser === 0 ? 1 : 0]++;
        break;
      }
      if (g) {
        const w = physics.ball.punchEffectX < NET ? 1 : 0;
        scores[w]++;
        loser = w === 0 ? 1 : 0;
        break;
      }
      if (rf > 4000) {
        loser = -2;
        break;
      }
    }
    const iWon = loser >= 0 && loser !== myIdx;
    agg.rallies++;
    if (iWon) agg.wins++;
    if (meServes) {
      agg.srvR++;
      if (iWon) agg.srvW++;
    } else {
      agg.rcvR++;
      if (iWon) agg.rcvW++;
    }
    isP2Serve = rng() < 0.5;
  }
  if (scores[meLeft ? 0 : 1] > scores[meLeft ? 1 : 0]) agg.setWins++;
  agg.sets++;
}

const ME_FILE = process.argv[2] || 'LuckyPunch_v07.js';
const OPPS = [
  'LuckyPunch_v01.js',
  'LuckyPunch_v02.js',
  'LuckyPunch_v03.js',
  'LuckyPunch_v04.js',
  'LuckyPunch_v05.js',
  'LuckyPunch_v06.js',
  'LuckyPunch_v07.js',
  'LuckyPunch_v09.js',
  'LuckyPunch_v10.js',
].filter(
  (f) =>
    f !== ME_FILE &&
    (!process.argv[4] || process.argv[4].split(',').includes(f))
);
const pct = (w, n) =>
  n ? ((w / n) * 100).toFixed(1).padStart(5) + '%' : '    —';
console.log(
  `${ME_FILE} 상대별 랠리 승률 (lag1, 지터{0,8}, 양 진영, 상대당 48세트)`
);
console.log('상대 |  랠리 승률 (표본)   | 서브 랠리 | 리시브 랠리 | 세트');
for (const opp of OPPS) {
  const agg = {
    sets: 0,
    setWins: 0,
    rallies: 0,
    wins: 0,
    srvR: 0,
    srvW: 0,
    rcvR: 0,
    rcvW: 0,
    decisions: 0,
    decideMs: 0,
    maxDecideMs: 0,
  };
  for (let i = 0; i < 12; i++)
    for (const jit of [0, 8])
      for (const L of [true, false])
        runSet(ME_FILE, opp, 61000 + i * 7919, jit, L, agg);
  const name = opp.replace('LuckyPunch_', '').replace('.js', '');
  console.log(
    `${name.padEnd(4)} | ${pct(agg.wins, agg.rallies)} (${String(
      agg.rallies
    ).padStart(4)}랠리) |  ${pct(agg.srvW, agg.srvR)}  |   ${pct(
      agg.rcvW,
      agg.rcvR
    )}  | ${pct(agg.setWins, agg.sets)}`
  );
  console.log(
    `     decide 평균 ${(
      agg.decideMs / Math.max(1, agg.decisions)
    ).toFixed(3)}ms / 최대 ${agg.maxDecideMs.toFixed(3)}ms`
  );
}
