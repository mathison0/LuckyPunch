import fs from 'node:fs';
import vm from 'node:vm';

export const K = Object.freeze({
  GROUND_WIDTH: 432,
  HALF: 216,
  PLAYER_HALF: 32,
  PLAYER_GROUND_Y: 244,
  BALL_GROUND_Y: 252,
  NET_HALF: 25,
  NET_TOP: 176,
  NET_BOTTOM: 192,
  TICK_GROUP: 3,
  WALK: 6,
  DIVE: 8,
});

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng) {
  return Math.floor(32768 * rng());
}

class Player {
  constructor(isP2) {
    this.isPlayer2 = isP2;
    this.divingDirection = 0;
    this.lyingDownDurationLeft = -1;
    this.initialize();
  }
  initialize() {
    this.x = this.isPlayer2 ? 396 : 36;
    this.y = K.PLAYER_GROUND_Y;
    this.yVelocity = 0;
    this.isCollisionWithBallHappened = false;
    this.state = 0;
    this.frameNumber = 0;
    this.normalStatusArmSwingDirection = 1;
    this.delayBeforeNextFrame = 0;
    this.divingDirection = 0;
    this.lyingDownDurationLeft = -1;
  }
}

class Ball {
  constructor() {
    this.initialize(false);
  }
  initialize(isP2Serve) {
    this.x = isP2Serve ? 376 : 56;
    this.y = 0;
    this.xVelocity = 0;
    this.yVelocity = 1;
    this.isPowerHit = false;
    this.expectedLandingPointX = 0;
  }
}

function ballPlayerOverlap(ball, p) {
  return (
    Math.abs(ball.x - p.x) <= K.PLAYER_HALF &&
    Math.abs(ball.y - p.y) <= K.PLAYER_HALF
  );
}

function processWorld(ball) {
  const events = [];
  const futureX = ball.x + ball.xVelocity;
  if (futureX < 0 || futureX > K.GROUND_WIDTH) {
    events.push(futureX < 0 ? 'WALL_LEFT' : 'WALL_RIGHT');
    ball.xVelocity = -ball.xVelocity;
  }

  let futureY = ball.y + ball.yVelocity;
  if (futureY < 0) {
    events.push('CEILING');
    ball.yVelocity = 1;
  }

  if (Math.abs(ball.x - K.HALF) < K.NET_HALF && ball.y > K.NET_TOP) {
    if (ball.y <= K.NET_BOTTOM) {
      if (ball.yVelocity > 0) {
        events.push('NET_TOP');
        ball.yVelocity = -ball.yVelocity;
      }
    } else {
      events.push(ball.x < K.HALF ? 'NET_SIDE_LEFT' : 'NET_SIDE_RIGHT');
      if (ball.x < K.HALF) ball.xVelocity = -Math.abs(ball.xVelocity);
      else ball.xVelocity = Math.abs(ball.xVelocity);
    }
  }

  futureY = ball.y + ball.yVelocity;
  if (futureY > K.BALL_GROUND_Y) {
    events.push('GROUND');
    ball.yVelocity = -ball.yVelocity;
    ball.y = K.BALL_GROUND_Y;
    return { ground: true, events };
  }
  ball.y = futureY;
  ball.x += ball.xVelocity;
  ball.yVelocity += 1;
  return { ground: false, events };
}

function calculateExpectedLanding(ball) {
  const b = {
    x: ball.x,
    y: ball.y,
    xVelocity: ball.xVelocity,
    yVelocity: ball.yVelocity,
  };
  for (let loop = 0; loop < 1000; loop++) {
    const fx = b.x + b.xVelocity;
    if (fx < 0 || fx > K.GROUND_WIDTH) b.xVelocity = -b.xVelocity;
    if (b.y + b.yVelocity < 0) b.yVelocity = 1;
    if (Math.abs(b.x - K.HALF) < K.NET_HALF && b.y > K.NET_TOP) {
      // Deliberately matches calculateExpectedLandingPointXFor(), including
      // its < 192 quirk.
      if (b.y < K.NET_BOTTOM) {
        if (b.yVelocity > 0) b.yVelocity = -b.yVelocity;
      } else {
        if (b.x < K.HALF) b.xVelocity = -Math.abs(b.xVelocity);
        else b.xVelocity = Math.abs(b.xVelocity);
      }
    }
    b.y += b.yVelocity;
    if (b.y > K.BALL_GROUND_Y) {
      ball.expectedLandingPointX = b.x;
      return;
    }
    b.x += b.xVelocity;
    b.yVelocity += 1;
  }
  ball.expectedLandingPointX = b.x;
}

function processPlayer(p, action) {
  if (p.state === 4) {
    p.lyingDownDurationLeft -= 1;
    if (p.lyingDownDurationLeft < -1) p.state = 0;
    return;
  }

  let vx = 0;
  if (p.state < 5) vx = p.state < 3 ? action.x * 6 : p.divingDirection * 8;
  const futureX = p.x + vx;
  p.x = futureX;
  if (!p.isPlayer2) p.x = Math.max(32, Math.min(184, p.x));
  else p.x = Math.max(248, Math.min(400, p.x));

  if (p.state < 3 && action.y === -1 && p.y === K.PLAYER_GROUND_Y) {
    p.yVelocity = -16;
    p.state = 1;
    p.frameNumber = 0;
  }

  const futureY = p.y + p.yVelocity;
  p.y = futureY;
  if (futureY < K.PLAYER_GROUND_Y) p.yVelocity += 1;
  else if (futureY > K.PLAYER_GROUND_Y) {
    p.yVelocity = 0;
    p.y = K.PLAYER_GROUND_Y;
    p.frameNumber = 0;
    if (p.state === 3) {
      p.state = 4;
      p.lyingDownDurationLeft = 3;
    } else p.state = 0;
  }

  if (action.hit === 1) {
    if (p.state === 1) {
      p.delayBeforeNextFrame = 5;
      p.frameNumber = 0;
      p.state = 2;
    } else if (p.state === 0 && action.x !== 0) {
      p.state = 3;
      p.frameNumber = 0;
      p.divingDirection = action.x;
      p.yVelocity = -5;
    }
  }

  if (p.state === 1) p.frameNumber = (p.frameNumber + 1) % 3;
  else if (p.state === 2) {
    if (p.delayBeforeNextFrame < 1) {
      p.frameNumber += 1;
      if (p.frameNumber > 4) {
        p.frameNumber = 0;
        p.state = 1;
      }
    } else p.delayBeforeNextFrame -= 1;
  }
}

function collide(ball, p, action, rng) {
  if (ball.x < p.x) ball.xVelocity = -Math.floor(Math.abs(ball.x - p.x) / 3);
  else if (ball.x > p.x) ball.xVelocity = Math.floor(Math.abs(ball.x - p.x) / 3);
  if (ball.xVelocity === 0) ball.xVelocity = (randInt(rng) % 3) - 1;

  const av = Math.abs(ball.yVelocity);
  ball.yVelocity = -av;
  if (av < 15) ball.yVelocity = -15;

  if (p.state === 2) {
    if (ball.x < K.HALF) ball.xVelocity = (Math.abs(action.x) + 1) * 10;
    else ball.xVelocity = -(Math.abs(action.x) + 1) * 10;
    ball.yVelocity = Math.abs(ball.yVelocity) * action.y * 2;
    ball.isPowerHit = true;
  } else ball.isPowerHit = false;
  calculateExpectedLanding(ball);
}

export class Engine {
  constructor(seed = 1) {
    this.rng = mulberry32(seed);
    this.p1 = new Player(false);
    this.p2 = new Player(true);
    this.ball = new Ball();
    this.scores = [0, 0];
    this.frame = 0;
    this.isPlayer2Serve = false;
    this.touchCount = 0;
    this.lastToucher = null;
    this.prevBallLeft = null;
    this.lastWorldEvents = [];
  }

  resetRound(serverP2 = null) {
    this.p1.initialize();
    this.p2.initialize();
    if (serverP2 == null) serverP2 = randInt(this.rng) % 2 === 1;
    this.isPlayer2Serve = serverP2;
    this.ball.initialize(serverP2);
    calculateExpectedLanding(this.ball);
    this.touchCount = 0;
    this.lastToucher = null;
    this.prevBallLeft = null;
  }

  snapshot(side, rallyFrameCount = 0) {
    const right = side === 'RIGHT';
    const self = right ? this.p2 : this.p1;
    const opp = right ? this.p1 : this.p2;
    return {
      tick: this.frame,
      side,
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
        x: this.ball.x,
        y: this.ball.y,
        xVelocity: this.ball.xVelocity,
        yVelocity: this.ball.yVelocity,
        expectedLandingPointX: this.ball.expectedLandingPointX,
        isPowerHit: this.ball.isPowerHit,
      },
      meta: {
        score: { self: right ? this.scores[1] : this.scores[0], opp: right ? this.scores[0] : this.scores[1] },
        isPlayer2Serve: this.isPlayer2Serve,
        rallyFrameCount,
      },
      config: { tickFrameGroupSize: K.TICK_GROUP },
    };
  }

  frameState(a1 = null, a2 = null, result = null) {
    return {
      frame: this.frame,
      score: [...this.scores],
      p1: { x: this.p1.x, y: this.p1.y, state: this.p1.state, frameNumber: this.p1.frameNumber, divingDirection: this.p1.divingDirection },
      p2: { x: this.p2.x, y: this.p2.y, state: this.p2.state, frameNumber: this.p2.frameNumber, divingDirection: this.p2.divingDirection },
      ball: { x: this.ball.x, y: this.ball.y, vx: this.ball.xVelocity, vy: this.ball.yVelocity, landingX: this.ball.expectedLandingPointX, isPowerHit: this.ball.isPowerHit },
      action1: a1 ? { ...a1 } : null,
      action2: a2 ? { ...a2 } : null,
      events: [...(this.lastWorldEvents || [])],
      result: result ? { ...result } : null,
    };
  }

  step(a1, a2) {
    this.frame++;
    const world = processWorld(this.ball);
    const ground = world.ground;
    this.lastWorldEvents = world.events;
    calculateExpectedLanding(this.ball);
    processPlayer(this.p1, a1);
    calculateExpectedLanding(this.ball);
    processPlayer(this.p2, a2);

    const players = [this.p1, this.p2];
    const actions = [a1, a2];
    for (let i = 0; i < 2; i++) {
      const p = players[i];
      const overlap = ballPlayerOverlap(this.ball, p);
      if (overlap) {
        if (!p.isCollisionWithBallHappened) {
          collide(this.ball, p, actions[i], this.rng);
          p.isCollisionWithBallHappened = true;
          this.registerTouch(i);
        }
      } else p.isCollisionWithBallHappened = false;
    }

    this.observeCrossing();

    if (ground) {
      const loser = this.ball.x < K.HALF ? 0 : 1;
      const winner = loser ^ 1;
      this.scores[winner] += 1;
      return { point: winner, reason: 'ground' };
    }
    if (this.forcedPoint != null) {
      const winner = this.forcedPoint;
      this.forcedPoint = null;
      this.scores[winner] += 1;
      return { point: winner, reason: 'touch-limit' };
    }
    return null;
  }

  observeCrossing() {
    const left = this.ball.x < K.HALF;
    if (this.prevBallLeft != null && left !== this.prevBallLeft) {
      this.touchCount = 0;
      this.lastToucher = null;
    }
    this.prevBallLeft = left;
  }

  registerTouch(i) {
    if (this.lastToucher != null && this.lastToucher !== i) this.touchCount = 0;
    this.lastToucher = i;
    this.touchCount++;
    if (this.touchCount >= 5) {
      this.forcedPoint = i ^ 1;
      this.touchCount = 0;
      this.lastToucher = null;
    }
  }
}

function safeAction(a) {
  if (!a || ![-1, 0, 1].includes(a.x) || ![-1, 0, 1].includes(a.y) || ![0, 1].includes(a.hit)) {
    return { x: 0, y: 0, hit: 0 };
  }
  return { x: a.x, y: a.y, hit: a.hit };
}

export function loadBot(file, cfgOverride = null) {
  const source = fs.readFileSync(file, 'utf8');
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math,
    Date,
    JSON,
    Array,
    Map,
    Set,
    Object,
    Number,
    String,
    Boolean,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  if (cfgOverride) sandbox.__PIKA_CFG__ = cfgOverride;
  const context = vm.createContext(sandbox);
  vm.runInContext(source + '\n;globalThis.__BOT_DECIDE__ = decide;', context, { filename: file });
  if (typeof context.__BOT_DECIDE__ !== 'function') throw new Error(`No decide() in ${file}`);
  return { decide: context.__BOT_DECIDE__, context };
}

export class BotScheduler {
  constructor(bot, side, latencyFrames = 1) {
    this.bot = bot;
    this.side = side;
    this.latencyFrames = latencyFrames;
    this.latest = { x: 0, y: 0, hit: 0 };
    this.pending = [];
    this.rallyFrames = 0;
    this.prevScoreTotal = 0;
    this.latestDebug = null;
  }
  resetForMatch() {
    this.latest = { x: 0, y: 0, hit: 0 };
    this.pending = [];
    this.rallyFrames = 0;
    this.prevScoreTotal = 0;
    this.latestDebug = null;
  }
  beforeFrame(engine) {
    while (this.pending.length && this.pending[0].applyFrame <= engine.frame + 1) {
      this.latest = this.pending.shift().action;
    }
    const total = engine.scores[0] + engine.scores[1];
    if (total !== this.prevScoreTotal) {
      this.rallyFrames = 0;
      this.prevScoreTotal = total;
    } else this.rallyFrames++;

    const nextFrame = engine.frame + 1;
    if (nextFrame % K.TICK_GROUP === 0) {
      const snap = engine.snapshot(this.side, this.rallyFrames);
      let action;
      try {
        action = safeAction(this.bot.decide(snap));
        this.latestDebug = this.bot.context && this.bot.context.__PIKA_DEBUG_STATE__
          ? JSON.parse(JSON.stringify(this.bot.context.__PIKA_DEBUG_STATE__))
          : null;
      }
      catch { action = { x: 0, y: 0, hit: 0 }; }
      this.pending.push({ applyFrame: nextFrame + this.latencyFrames, action });
    }
    return this.latest;
  }
}

export function playSet({
  leftBot,
  rightBot,
  seed = 1,
  latencyLeft = 1,
  latencyRight = 1,
  winningScore = 10,
  maxFrames = 6000,
  trace = false,
}) {
  const engine = new Engine(seed);
  const left = new BotScheduler(leftBot, 'LEFT', latencyLeft);
  const right = new BotScheduler(rightBot, 'RIGHT', latencyRight);
  engine.resetRound(null);
  const points = [];

  while (engine.scores[0] < winningScore && engine.scores[1] < winningScore && engine.frame < maxFrames) {
    const a1 = left.beforeFrame(engine);
    const a2 = right.beforeFrame(engine);
    const result = engine.step(a1, a2);
    if (result) {
      points.push({ frame: engine.frame, ...result, score: [...engine.scores] });
      if (engine.scores[0] >= winningScore || engine.scores[1] >= winningScore) break;
      engine.resetRound(null);
    }
  }

  const winner = engine.scores[0] === engine.scores[1]
    ? -1
    : engine.scores[0] > engine.scores[1] ? 0 : 1;
  return {
    winner,
    score: [...engine.scores],
    frames: engine.frame,
    points: trace ? points : undefined,
  };
}

export function runSeries({
  leftFile,
  rightFile,
  leftCfg = null,
  rightCfg = null,
  matches = 20,
  seed = 1,
  latencySet = [1, 2, 3],
}) {
  let leftWins = 0;
  let rightWins = 0;
  let draws = 0;
  let diff = 0;
  const scores = [];
  for (let i = 0; i < matches; i++) {
    const lat = latencySet[i % latencySet.length];
    const leftBot = loadBot(leftFile, leftCfg);
    const rightBot = loadBot(rightFile, rightCfg);
    const result = playSet({
      leftBot,
      rightBot,
      seed: seed + i * 7919,
      latencyLeft: lat,
      latencyRight: latencySet[(i + 1) % latencySet.length],
    });
    if (result.winner === 0) leftWins++;
    else if (result.winner === 1) rightWins++;
    else draws++;
    diff += result.score[0] - result.score[1];
    scores.push(result.score);
  }
  return {
    leftWins,
    rightWins,
    draws,
    matches,
    winRate: leftWins / matches,
    avgPointDiff: diff / matches,
    scores,
  };
}
