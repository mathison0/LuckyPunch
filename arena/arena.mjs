// 오프라인 대전 하네스 — 실제 게임 엔진(physics.mjs)을 그대로 돌려서
// 봇 vs 봇 / 봇 vs 내장 AI 를 브라우저 없이 수천 판 돌린다.
import fs from 'node:fs';
import vm from 'node:vm';
import { PikaPhysics, PikaUserInput } from './physics.mjs';

const TICK_GROUP = 3;
const NET_X = 216;
const MAX_TOUCHES_PER_SIDE = 5;
const MAX_RALLY_FRAMES = 4000;
// pikavolley.js frameTotal: 점수 후 afterEndOfRound(5) → beforeStartOfNextRound(30).
// 이 구간에는 physics가 돌지 않지만 getInput()은 매 프레임 호출된다.
// 즉 봇은 "얼어붙은" 스냅샷을 10틱쯤 받고, 그때 낸 결정이 랠리 첫 프레임에 그대로 적용된다.
// 이걸 빼먹으면 오프라인 결과가 브라우저와 완전히 달라진다.
const FROZEN_AFTER_ROUND = 5;
const FROZEN_READY = 30;
const FROZEN_FIRST_ROUND = 71; // startOfNewGame

// ── 결정론적 RNG (엔진의 rand()가 Math.random을 쓰므로 이걸 갈아끼운다) ──
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── 봇 로드: 각 봇을 별도 vm 컨텍스트에 넣어 Worker 격리를 흉내낸다 ──
function loadBot(path, overrides) {
  let src = fs.readFileSync(path, 'utf8');
  if (overrides) {
    for (const [name, value] of Object.entries(overrides)) {
      const re = new RegExp('(var\\s+' + name + '\\s*=\\s*)[-\\d.]+', 'm');
      if (!re.test(src)) throw new Error('튜닝 상수 없음: ' + name + ' in ' + path);
      src = src.replace(re, '$1' + value);
    }
  }
  const ctx = vm.createContext({
    Math, JSON, console, Date, Array, Object, Number, String,
    isNaN, isFinite, parseInt, parseFloat, Map, Set, RegExp,
  });
  vm.runInContext(src, ctx, { filename: path });
  const decide = vm.runInContext('typeof decide === "function" ? decide : null', ctx);
  if (!decide) throw new Error('decide 함수 없음: ' + path);
  return decide;
}

function sanitize(a) {
  if (!a || typeof a !== 'object') return { x: 0, y: 0, hit: 0 };
  const ok = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi && Number.isInteger(v));
  if (!ok(a.x, -1, 1) || !ok(a.y, -1, 1) || !ok(a.hit, 0, 1)) return { x: 0, y: 0, hit: 0 };
  return { x: a.x, y: a.y, hit: a.hit };
}

function buildSnapshot(tick, side, physics, scores, isPlayer2Serve, rallyFrameCount) {
  const isP2 = side === 'RIGHT';
  const self = isP2 ? physics.player2 : physics.player1;
  const opp = isP2 ? physics.player1 : physics.player2;
  const view = (p) => ({
    x: p.x, y: p.y, state: p.state,
    frameNumber: p.frameNumber, divingDirection: p.divingDirection,
  });
  return {
    tick, side,
    self: view(self), opp: view(opp),
    ball: {
      x: physics.ball.x, y: physics.ball.y,
      xVelocity: physics.ball.xVelocity, yVelocity: physics.ball.yVelocity,
      isPowerHit: physics.ball.isPowerHit,
      expectedLandingPointX: physics.ball.expectedLandingPointX,
    },
    meta: {
      score: { self: isP2 ? scores[1] : scores[0], opp: isP2 ? scores[0] : scores[1] },
      isPlayer2Serve, rallyFrameCount,
    },
    config: { tickFrameGroupSize: TICK_GROUP },
  };
}

// botInput.js의 getInput()을 그대로 흉내낸다:
// 매 프레임 latestAction을 적용하고, 3프레임마다 새 스냅샷으로 요청을 건다.
// 응답은 applyLag 프레임 뒤에 반영된다 (Worker 왕복 지연).
class BotSide {
  constructor(decide, side, applyLag) {
    this.decide = decide;
    this.side = side;
    this.applyLag = applyLag;
    this.input = new PikaUserInput();
    this.latest = { x: 0, y: 0, hit: 0 };
    this.pending = null;
    this.tick = 0;
    this.rallyFrameCount = 0;
    this.prevScoreTotal = 0;
    this.errors = 0;
  }
  getInput(frame, physics, scores, isPlayer2Serve) {
    if (this.pending !== null && frame >= this.pending.readyAt) {
      this.latest = this.pending.action;
      this.pending = null;
    }
    this.input.xDirection = this.latest.x;
    this.input.yDirection = this.latest.y;
    this.input.powerHit = this.latest.hit;

    const total = scores[0] + scores[1];
    if (total !== this.prevScoreTotal) {
      this.rallyFrameCount = 0;
      this.prevScoreTotal = total;
    } else {
      this.rallyFrameCount++;
    }

    this.tick++;
    if (this.tick % TICK_GROUP !== 0) return;
    if (this.pending !== null) return;

    const snap = buildSnapshot(this.tick, this.side, physics, scores, isPlayer2Serve, this.rallyFrameCount);
    let action;
    try {
      action = sanitize(this.decide(snap));
    } catch (e) {
      this.errors++;
      action = { x: 0, y: 0, hit: 0 };
    }
    this.pending = { action, readyAt: frame + this.applyLag };
  }
}

// 내장 AI 쪽은 엔진이 userInput을 직접 채워주므로 빈 입력 객체만 넘긴다.
class AiSide {
  constructor() { this.input = new PikaUserInput(); this.errors = 0; }
  getInput() {}
}

// 5회 연속 접촉 규칙 (rules/touchLimit.js와 동일한 판정)
class TouchLimit {
  constructor() { this.reset(); this.prevOnLeft = null; }
  reset() { this.count = 0; this.last = null; this.prevFlags = [false, false]; }
  // 실점해야 할 쪽이 있으면 그 인덱스를 반환
  observe(physics) {
    const onLeft = physics.ball.x < NET_X;
    if (this.prevOnLeft !== null && onLeft !== this.prevOnLeft) this.reset();
    this.prevOnLeft = onLeft;
    const players = [physics.player1, physics.player2];
    let loser = -1;
    for (let i = 0; i < 2; i++) {
      const colliding = players[i].isCollisionWithBallHappened;
      if (colliding && !this.prevFlags[i]) {
        if (this.last !== null && this.last !== i) this.count = 0;
        this.last = i;
        this.count += 1;
        if (this.count >= MAX_TOUCHES_PER_SIDE) { this.reset(); loser = i; }
      }
      this.prevFlags[i] = colliding;
    }
    return loser;
  }
}

/**
 * 한 세트를 끝까지 돌린다.
 * sides[i] = {kind:'bot', decide} | {kind:'ai'}
 * @return {{scores:number[], frames:number, rallies:number, errors:number[]}}
 */
export function playSet(sides, { winningScore = 10, seed = 1, applyLag = 1, rng = null, jitter = 0 } = {}) {
  const random = rng || makeRng(seed);
  const physics = new PikaPhysics(sides[0].kind === 'ai', sides[1].kind === 'ai');
  const runners = sides.map((s, i) =>
    s.kind === 'ai' ? new AiSide() : new BotSide(s.decide, i === 0 ? 'LEFT' : 'RIGHT', applyLag)
  );
  const inputs = runners.map((r) => r.input);
  const scores = [0, 0];
  const touch = new TouchLimit();
  let isPlayer2Serve = random() < 0.5;
  let frame = 0;
  let rallies = 0;

  let firstRound = true;
  while (scores[0] < winningScore && scores[1] < winningScore) {
    // 점수 직후: 공이 떨어진 자리 그대로 5프레임 (physics 정지)
    if (!firstRound) {
      for (let i = 0; i < FROZEN_AFTER_ROUND; i++) {
        runners[0].getInput(frame, physics, scores, isPlayer2Serve);
        runners[1].getInput(frame, physics, scores, isPlayer2Serve);
        frame++;
      }
    }
    physics.player1.initializeForNewRound();
    physics.player2.initializeForNewRound();
    physics.ball.initializeForNewRound(isPlayer2Serve);
    if (jitter > 0) {
      // 봇끼리 붙이면 매 세트가 똑같은 결정론적 재생이 되어 표본이 1개가 된다.
      // 시작 위치를 조금 흔들어 통계적으로 의미 있게 만든다.
      const j = () => Math.round((random() * 2 - 1) * jitter);
      physics.ball.x += j();
      physics.player1.x = Math.max(32, Math.min(184, physics.player1.x + j()));
      physics.player2.x = Math.max(248, Math.min(400, physics.player2.x + j()));
    }
    touch.reset();
    touch.prevOnLeft = null;
    rallies++;
    // "Ready" 구간: 공·플레이어는 서브 위치에 고정, physics 정지, getInput은 계속 호출
    const frozen = firstRound ? FROZEN_FIRST_ROUND : FROZEN_READY;
    firstRound = false;
    for (let i = 0; i < frozen; i++) {
      runners[0].getInput(frame, physics, scores, isPlayer2Serve);
      runners[1].getInput(frame, physics, scores, isPlayer2Serve);
      frame++;
    }
    rallies--; rallies++;

    let rallyFrames = 0;
    while (true) {
      runners[0].getInput(frame, physics, scores, isPlayer2Serve);
      runners[1].getInput(frame, physics, scores, isPlayer2Serve);
      const grounded = physics.runEngineForNextFrame(inputs);
      frame++;
      rallyFrames++;

      const touchLoser = touch.observe(physics);
      if (touchLoser >= 0) {
        scores[touchLoser === 0 ? 1 : 0] += 1;
        isPlayer2Serve = random() < 0.5;
        break;
      }
      if (grounded) {
        if (physics.ball.punchEffectX < NET_X) scores[1] += 1;
        else scores[0] += 1;
        isPlayer2Serve = random() < 0.5;
        break;
      }
      if (rallyFrames > MAX_RALLY_FRAMES) { break; } // 무승부 랠리 — 점수 없음
    }
  }
  return {
    scores,
    frames: frame,
    rallies,
    errors: runners.map((r) => r.errors),
  };
}

export { loadBot, makeRng };
