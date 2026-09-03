/*
 * ============================================================================
 * PikaPlanner v2.1 ANNOTATED FIELD COPY
 * ---------------------------------------------------------------------------
 * 실행 로직은 PikaPlanner_v2_1_stable_candidate.js와 동일하고 주석만 추가한 버전이다.
 * 제출 파일로 써도 동작은 같지만, 현장에서는 원본 stable_candidate를 제출용 기준선으로
 * 보관하고 이 파일을 읽기/수정용으로 사용하는 것을 권장한다.
 * ============================================================================
 */
'use strict';

/*
 * PikaPlanner_v2.js
 * ============================================================================
 * Rebuilt competition bot for the disclosed Pikachu / Leonyi Volleyball engine.
 *
 * v2 design principles
 * --------------------
 * 1. Canonical LEFT-side coordinates everywhere inside the planner.
 * 2. One physics implementation is shared by offense, defense and prediction.
 * 3. Every simulated ball trajectory records WALL / NET_TOP / NET_SIDE events.
 * 4. Shot quality is evaluated against the opponent's FULL trajectory
 *    interceptability, not only final landing X.
 * 5. Opponent reachability is propagated in 3-frame held-action blocks so
 *    jump / dive / committed states are represented explicitly.
 * 6. Opponent pre-contact defense predicts the opponent's future CONTACT first,
 *    then rolls out the shots they can create from that contact state.
 * 7. Planner intent and engine action are separated by a safety executor so
 *    held inputs cannot accidentally turn into a dive / re-jump after landing.
 * 8. Tournament-day skill changes are isolated to the SKILL adapter and a few
 *    clearly marked hooks.
 *
 * The file has no imports and defines the required top-level decide(snapshot).
 */

// ============================================================================
// [A] DISCLOSED ENGINE CONSTANTS -- DO NOT TUNE
// ============================================================================
const C = Object.freeze({
  W: 432,
  NET_X: 216,
  PLAYER_HALF: 32,
  LEFT_MIN: 32,
  LEFT_MAX: 184,
  RIGHT_MIN: 248,
  RIGHT_MAX: 400,
  PLAYER_GROUND_Y: 244,
  BALL_GROUND_Y: 252,
  NET_HALF: 25,
  NET_TOP: 176,
  NET_BOTTOM: 192,
  WALK: 6,
  DIVE: 8,
  JUMP_VY: -16,
  DIVE_VY: -5,
  GRAVITY: 1,
  TICK_GROUP: 3,
});

// ============================================================================
// [B] TUNABLE PARAMETERS -- SAFE MATCH-DAY / OFFLINE-TUNING AREA
// ============================================================================
/*
 * [현장 튜닝 원칙]
 * 이 블록은 바꿔도 되는 숫자들이지만 한 번에 여러 계열을 바꾸지 않는다.
 * latency/hold -> receive -> jump -> defense -> shot weights 순으로 독립 A/B하고,
 * 평균 승률뿐 아니라 touch-limit, blowout, LEFT/RIGHT 분산을 함께 기록한다.
 */
const DEFAULT_CFG = Object.freeze({
  // Control / movement
  ACTION_LATENCY: 1,
  MOVE_DEADBAND: 4,
  HOME_X: 108,
  BALL_HORIZON: 96,
  CONTACT_HORIZON: 48,
  THREAT_HORIZON: 18,
  POWER_SEARCH_HOLD: 8,

  // Receive geometry. Positive offset means canonical player stands LEFT of
  // the ball, sending an ordinary bump toward the net/right.
  RECEIVE_OFFSETS: [8, 12, 18, 24, 30],
  SELF_SET_TARGET_X: 170,
  SELF_SET_MAX_TOUCH_EST: 2, // [현재 미사용] legacy/tuning placeholder; safety gate는 selfSetUsed/pendingTick
  SELF_SET_DEEP_BALL_X: 142,
  SELF_SET_SCORE: 92,

  // Jump planning
  JUMP_MAX_CONTACT: 27,
  JUMP_MIN_VALUE_GAIN: 8,
  JUMP_POWER_MIN_CONTACT_FRAME: 4,

  // Dive
  DIVE_HORIZON: 13,
  DIVE_MIN_BALL_Y: 166,
  DIVE_EXTRA_MARGIN: 5,

  // Full-trajectory shot evaluation
  SHOT_UNRETURNABLE: 520,
  SHOT_RETURN_BASE: 170,
  SHOT_INTERCEPT_FRAME_WEIGHT: 7.5,
  SHOT_INTERCEPT_OPTIONS_WEIGHT: 1.6,
  SHOT_LANDING_DISTANCE_WEIGHT: 0.22,
  SHOT_EDGE_WEIGHT: 0.10,
  SHOT_TIME_WEIGHT: 0.42,
  SHOT_WALL_EVENT_BONUS: 5,
  SHOT_NET_TOP_EVENT_BONUS: 8,
  SHOT_NET_SIDE_EVENT_BONUS: 10,
  SHOT_LATE_REVERSAL_BONUS: 5,
  SHOT_SELF_SIDE_PENALTY: 20000,

  // Reachability search. This is used for opponent shot-return evaluation.
  REACH_MAX_STATES: 4500, // [현재 미사용] full state-DP 시절 placeholder
  REACH_X_QUANT: 1, // [현재 미사용] closed-form reachability에서는 참조하지 않음

  // Defensive pre-positioning
  DEFENSE_X_STEP: 8,
  DEFENSE_MOVE_COST: 0.30,
  DEFENSE_NO_INTERCEPT_PENALTY: 1000,
  DEFENSE_THREAT_LIMIT: 24,
  DEFENSE_CONTACT_WINDOW: 3,

  // Power arm gating
  POWER_NEAR_X: 78,
  POWER_NEAR_Y: 88,
  DOWN_SMASH_MAX_NET_DISTANCE: 100,

  // Input hold safety
  LANDING_SAFETY_FRAMES: 3,

  // Match context
  LEAD_SAFE: 2,
  TRAIL_AGGRO: -2,
  LEAD_RISK_SCALE: 0.92,
  TRAIL_RISK_SCALE: 1.08,

  // Debug
  DEBUG: 0,
  DEBUG_EVERY: 60,
  DEBUG_EXPORT: 0,
});

// Optional runtime override for local simulator tuning.
const RUNTIME_CFG =
  typeof globalThis !== 'undefined' && globalThis.__PIKA_CFG__
    ? globalThis.__PIKA_CFG__
    : null;
const CFG = Object.assign({}, DEFAULT_CFG, RUNTIME_CFG || {});

// ============================================================================
// [C] SKILL ADAPTER -- TOURNAMENT-DAY PRIMARY EDIT AREA
// ============================================================================
/*
 * [스킬 공개 당일]
 * 가장 먼저 이 adapter에서 새 field/action/physics/reach/resource를 분류한다.
 * core planner에 직접 if(skill...)을 흩뿌리는 것은 최후의 수단이다.
 */
const SKILL = {
  read(_snapshot) {
    // Fill only after the real skill fields are released.
    return { enabled: false };
  },

  transformContext(ctx) {
    return ctx;
  },

  // Called once inside the ordinary world-ball frame update. If a released
  // skill modifies gravity / speed / collision, mirror the released frame
  // order here rather than sprinkling skill checks through the planner.
  ballFrameHook(_ball, _skillState, _events) {},

  // Optional player reach modifier (dash, enlarged hitbox, etc.).
  // [중요] 현재 core에서는 아직 호출되지 않는 예약 훅이다.
  // 대회 스킬이 dash/teleport/enlarged-hitbox처럼 reachability를 바꾸면
  // canPlayerReachBallAt()/self contact planner에도 명시적으로 연결해야 한다.
  reachActions(_node, _who, _ctx) {
    return [];
  },

  // Optional additional tactical candidate actions.
  extraActions(_ctx) {
    return [];
  },

  evaluate(_ctx, _candidate) {
    return 0;
  },

  emergencyOverride(_ctx, _planned) {
    return null;
  },
};

// ============================================================================
// [D] SMALL UTILITIES / MEMORY
// ============================================================================
/*
 * [메모리 주의]
 * Worker가 살아 있는 동안 rally 사이에도 globals가 유지된다. score/crossing에서 reset해야 할 값과
 * 경기 전체에 유지할 값을 구분한다. timeout 연속으로 Worker가 restart되면 globals는 모두 사라질 수 있다.
 */
const MEM = {
  decisions: 0,
  prev: null,
  lastAction: { x: 0, y: 0, hit: 0 }, // canonical action actually returned
  inferredOppXDir: 0,
  ownTouchEstimate: 0,
  oppTouchEstimate: 0,
  selfSetUsed: false,
  worldFlip: false,
  selfSetPendingTick: null,
  lastScoreSelf: 0,
  lastScoreOpp: 0,
  lastBall: null,
};

function abs(x) { return x < 0 ? -x : x; }
function sign(x) { return x < 0 ? -1 : x > 0 ? 1 : 0; }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function min(a, b) { return a < b ? a : b; }
function max(a, b) { return a > b ? a : b; }
function action(x, y, hit) { return { x: x | 0, y: y | 0, hit: hit ? 1 : 0 }; }
function cloneAction(a) { return action(a.x, a.y, a.hit); }

/**
 * [해설] 좌/우 진영 차이를 이 함수 하나에서 제거한다.
 * 내부 planner는 항상 "내가 LEFT"라고 믿고 동작한다. RIGHT일 때 x와 vx,
 * divingDirection을 거울 반전하고, 마지막에 uncanonicalize()로 action.x만 되돌린다.
 *
 * 현장 수정 주의:
 * - 새 스킬 필드가 좌우 방향성을 가지면 여기 또는 SKILL.transformContext에서
 *   반드시 같은 기준으로 canonicalize해야 한다.
 * - x==216 네트 중심의 equality branch는 완전 대칭이 아니므로 world physics에서
 *   MEM.worldFlip을 따로 사용한다. v2.1에서 고친 중요한 correctness 포인트다.
 */
function canonicalize(s) {
  const flip = s.side === 'RIGHT';
  const fx = (x) => flip ? C.W - x : x;
  const fvx = (vx) => flip ? -vx : vx;
  return SKILL.transformContext({
    flip,
    tick: s.tick | 0,
    tickGroup: (s.config && s.config.tickFrameGroupSize) || C.TICK_GROUP,
    self: {
      x: fx(s.self.x), y: s.self.y,
      state: s.self.state | 0,
      frameNumber: s.self.frameNumber | 0,
      divingDirection: flip ? -(s.self.divingDirection | 0) : (s.self.divingDirection | 0),
    },
    opp: {
      x: fx(s.opp.x), y: s.opp.y,
      state: s.opp.state | 0,
      frameNumber: s.opp.frameNumber | 0,
      divingDirection: flip ? -(s.opp.divingDirection | 0) : (s.opp.divingDirection | 0),
    },
    ball: {
      x: fx(s.ball.x), y: s.ball.y,
      vx: fvx(s.ball.xVelocity), vy: s.ball.yVelocity,
      isPowerHit: !!s.ball.isPowerHit,
      landingX: fx(s.ball.expectedLandingPointX),
    },
    scoreSelf: s.meta.score.self | 0,
    scoreOpp: s.meta.score.opp | 0,
    isPlayer2Serve: !!s.meta.isPlayer2Serve,
    rallyFrameCount: s.meta.rallyFrameCount | 0,
    skill: SKILL.read(s),
  });
}

/** [해설] canonical LEFT action을 실제 진영 action으로 되돌린다. y/hit은 대칭이므로 x만 반전한다. */
function uncanonicalize(a, flip) {
  return { x: flip ? -a.x : a.x, y: a.y, hit: a.hit };
}

// ============================================================================
// [E] PLAYER VERTICAL STATE ESTIMATION
// ============================================================================
/* 공개 엔진의 결정론적 점프 궤적 lookup. y축은 아래가 +이므로 작은 y가 더 높다. */
const JUMP_TABLE = (() => {
  const arr = [{ y: C.PLAYER_GROUND_Y, vy: 0 }];
  let y = C.PLAYER_GROUND_Y;
  let vy = C.JUMP_VY;
  for (let i = 1; i <= 40; i++) {
    y += vy;
    if (y < C.PLAYER_GROUND_Y) vy += 1;
    else if (y > C.PLAYER_GROUND_Y) { y = C.PLAYER_GROUND_Y; vy = 0; }
    arr.push({ y, vy });
    if (i > 1 && y === C.PLAYER_GROUND_Y) break;
  }
  return arr;
})();

/* dive activation frame 직후 y=244, vy=-5에서 시작하는 수직 궤적. */
const DIVE_TABLE = (() => {
  const arr = [{ y: C.PLAYER_GROUND_Y, vy: C.DIVE_VY }];
  let y = C.PLAYER_GROUND_Y;
  let vy = C.DIVE_VY;
  for (let i = 1; i <= 24; i++) {
    y += vy;
    if (y < C.PLAYER_GROUND_Y) vy += 1;
    else if (y > C.PLAYER_GROUND_Y) { y = C.PLAYER_GROUND_Y; vy = 0; }
    arr.push({ y, vy });
    if (i > 1 && y === C.PLAYER_GROUND_Y) break;
  }
  return arr;
})();

/**
 * [해설] snapshot에는 player yVelocity가 없으므로 공개 엔진의 점프/다이브 궤적표에서 vy를 역추정한다.
 * 같은 y가 상승/하강에 두 번 등장할 수 있어 직전 snapshot의 y 변화 방향(trend)을 우선한다.
 * 정확히 일치하지 않을 때는 3-frame snapshot 간 finite difference를 보수적으로 사용한다.
 */
function inferVyFromTable(table, p, prevP, fallback) {
  const trend = prevP ? sign(p.y - prevP.y) : 0;
  let best = null;
  let bestCost = 1e9;
  for (let i = 0; i < table.length; i++) {
    if (table[i].y !== p.y) continue;
    const vy = table[i].vy;
    let cost = 0;
    if (trend < 0 && vy > 0) cost += 100;
    if (trend > 0 && vy <= 0) cost += 100;
    cost += abs(vy - fallback) * 0.05;
    if (cost < bestCost) { bestCost = cost; best = vy; }
  }
  if (best != null) return best;
  if (prevP) return clamp(Math.round((p.y - prevP.y) / C.TICK_GROUP), -16, 16);
  return fallback;
}

/** [해설] 상태별 수직속도 추정 entry point. state 0/4/승패 상태는 0, dive는 DIVE_TABLE, jump/power는 JUMP_TABLE. */
function estimatePlayerVy(p, prevP) {
  if (p.state === 0 || p.state === 4 || p.state >= 5) return 0;
  if (p.state === 3) return inferVyFromTable(DIVE_TABLE, p, prevP, C.DIVE_VY);
  return inferVyFromTable(JUMP_TABLE, p, prevP, -4);
}

/**
 * [해설] snapshot 사이에 필요한 최소 상태를 갱신한다.
 * 핵심 invariant: 네트 crossing 또는 score change가 possession reset이다.
 * selfSetPendingTick은 "의도적으로 self-set을 한 번 시도했다"는 안전장치이며,
 * raw touch estimate가 틀리더라도 같은 possession에서 두 번째 self-set을 계획하지 않게 한다.
 *
 * 주의: ownTouchEstimate/oppTouchEstimate는 관측 기반 근사치다. 중력 때문에 vy가 매 프레임
 * 바뀌므로 safety-critical한 5-touch 판정에 직접 의존하면 안 된다.
 */
function updateMemory(c) {
  const scoreChanged = c.scoreSelf !== MEM.lastScoreSelf || c.scoreOpp !== MEM.lastScoreOpp;
  if (scoreChanged) {
    MEM.ownTouchEstimate = 0;
    MEM.oppTouchEstimate = 0;
    MEM.selfSetUsed = false;
    MEM.selfSetPendingTick = null;
  }

  if (
    MEM.selfSetPendingTick != null &&
    c.tick >= MEM.selfSetPendingTick &&
    c.ball.x < C.NET_X
  ) {
    // We deliberately attempted one controlled local touch. Even if the exact
    // collision occurred between snapshots (or barely missed), do not plan a
    // second intentional self-set in the same possession.
    MEM.selfSetUsed = true;
    MEM.selfSetPendingTick = null;
  }

  if (MEM.prev) {
    const dxOpp = c.opp.x - MEM.prev.opp.x;
    if (c.opp.state < 3 && abs(dxOpp) >= 3) MEM.inferredOppXDir = sign(dxOpp);
    else if (abs(dxOpp) < 3) MEM.inferredOppXDir = 0;

    const crossed = (MEM.prev.ball.x < C.NET_X) !== (c.ball.x < C.NET_X);
    if (crossed) {
      MEM.ownTouchEstimate = 0;
      MEM.oppTouchEstimate = 0;
      MEM.selfSetUsed = false;
      MEM.selfSetPendingTick = null;
    }

    if (MEM.lastBall) {
      const changed = c.ball.vx !== MEM.lastBall.vx || c.ball.vy !== MEM.lastBall.vy;
      if (changed) {
        const nearSelf = abs(c.ball.x - c.self.x) <= 38 && abs(c.ball.y - c.self.y) <= 40;
        const nearOpp = abs(c.ball.x - c.opp.x) <= 38 && abs(c.ball.y - c.opp.y) <= 40;
        if (nearSelf) MEM.ownTouchEstimate++;
        if (nearOpp) MEM.oppTouchEstimate++;
      }
    }
  }

  MEM.lastScoreSelf = c.scoreSelf;
  MEM.lastScoreOpp = c.scoreOpp;
  MEM.lastBall = { x: c.ball.x, y: c.ball.y, vx: c.ball.vx, vy: c.ball.vy };
}

// ============================================================================
// [F] SINGLE SOURCE OF TRUTH: BALL PHYSICS + EVENTS
// ============================================================================
/** [해설] rollout이 실제 snapshot 객체를 오염시키지 않도록 공 상태를 복제한다. */
function cloneBall(b) {
  return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, isPowerHit: !!b.isPowerHit };
}

/**
 * [해설] 공의 "월드 충돌 1프레임" 단일 진실원천(single source of truth).
 * offense/defense/self-set/위협 생성이 모두 이 함수를 사용해야 서로 다른 물리를 상상하지 않는다.
 * 처리 순서는 공개 physics.js와 맞춰야 하며, 특히 wall -> ceiling -> net -> skill hook -> ground -> position/gravity 순서를 유지한다.
 *
 * v2.1 중요 수정: canonical RIGHT에서도 실제 엔진의 x==216 네트 측면 tie-break가 보존되도록 MEM.worldFlip을 사용한다.
 */
function stepBallWorld(ball, skillState) {
  const events = [];

  const futureX = ball.x + ball.vx;
  if (futureX < 0 || futureX > C.W) {
    events.push({ type: futureX < 0 ? 'WALL_LEFT' : 'WALL_RIGHT', x: ball.x, y: ball.y });
    ball.vx = -ball.vx;
  }

  let futureY = ball.y + ball.vy;
  if (futureY < 0) {
    events.push({ type: 'CEILING', x: ball.x, y: ball.y });
    ball.vy = 1;
  }

  if (abs(ball.x - C.NET_X) < C.NET_HALF && ball.y > C.NET_TOP) {
    if (ball.y <= C.NET_BOTTOM) {
      if (ball.vy > 0) {
        events.push({ type: 'NET_TOP', x: ball.x, y: ball.y });
        ball.vy = -ball.vy;
      }
    } else {
      events.push({
        type: ball.x < C.NET_X ? 'NET_SIDE_LEFT' : 'NET_SIDE_RIGHT',
        x: ball.x,
        y: ball.y,
      });
      if (ball.x < C.NET_X) ball.vx = -abs(ball.vx);
      else if (ball.x > C.NET_X) ball.vx = abs(ball.vx);
      else ball.vx = MEM.worldFlip ? -abs(ball.vx) : abs(ball.vx);
    }
  }

  SKILL.ballFrameHook(ball, skillState, events);

  futureY = ball.y + ball.vy;
  if (futureY > C.BALL_GROUND_Y) {
    events.push({ type: 'GROUND', x: ball.x, y: C.BALL_GROUND_Y });
    ball.vy = -ball.vy;
    ball.y = C.BALL_GROUND_Y;
    return { ground: true, events };
  }

  ball.y = futureY;
  ball.x += ball.vx;
  ball.vy += C.GRAVITY;
  return { ground: false, events };
}

/** [해설] 현재 공 상태부터 ground까지 frame-by-frame rollout한다. cushion 분석을 위해 이벤트도 모두 보존한다. */
function simulateTrajectory(ball0, maxFrames, skillState) {
  const b = cloneBall(ball0);
  const frames = [];
  const events = [];
  for (let t = 1; t <= maxFrames; t++) {
    const r = stepBallWorld(b, skillState);
    if (r.events.length) {
      for (let i = 0; i < r.events.length; i++) {
        events.push({ t, type: r.events[i].type, x: r.events[i].x, y: r.events[i].y });
      }
    }
    frames.push({
      t, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
      ground: r.ground,
      events: r.events.length ? r.events.map((e) => e.type) : null,
    });
    if (r.ground) break;
  }
  return { frames, events };
}

/** [해설] trajectory 마지막 frame을 간단한 {x, frames} landing 정보로 축약한다. */
function trajectoryLanding(tr) {
  if (!tr || !tr.frames.length) return null;
  const f = tr.frames[tr.frames.length - 1];
  return { x: f.x, frames: f.t };
}

// ============================================================================
// [G] EXACT COLLISION RESPONSE -- USED EVERYWHERE
// ============================================================================
/**
 * [해설] player-ball collision의 유일한 응답 함수. ordinary bump와 power hit 모두 여기서 시작한다.
 * body hit의 vx는 접촉 오프셋 / 3, vy는 최소 15로 위쪽 반사된다. power는 그 결과의 |vy|를 2배해 y 입력(-1/0/+1)을 적용한다.
 * 정확한 중심 접촉은 엔진 RNG(-1/0/+1)이므로 planner는 의도적으로 피한다.
 */
function ordinaryCollisionFrom(ball0, playerX, power, inputX, inputY, hitterIsLeft) {
  const b = cloneBall(ball0);

  if (b.x < playerX) b.vx = -Math.floor(abs(b.x - playerX) / 3);
  else if (b.x > playerX) b.vx = Math.floor(abs(b.x - playerX) / 3);
  else b.vx = 0; // stochastic -1/0/1 in engine; planner avoids exact center.

  const av = abs(b.vy);
  b.vy = -av;
  if (av < 15) b.vy = -15;

  if (power) {
    b.vx = (abs(inputX) + 1) * 10 * (hitterIsLeft ? 1 : -1);
    b.vy = abs(b.vy) * inputY * 2; // => 2 * max(|pre vy|, 15)
    b.isPowerHit = true;
  } else {
    b.isPowerHit = false;
  }
  return b;
}

// ============================================================================
// [H] PLAYER REACHABILITY -- CLOSED-FORM / SMALL ENUMERATION
//
// We deliberately do NOT expand the full game tree. Horizontal movement has no
// inertia, and vertical motion comes from a tiny set of jump/dive trajectories.
// So reachability can be answered directly: "at global frame t, can any legal
// ground/jump/dive trajectory overlap this ball frame?" This is much faster
// than a state-set DP while preserving the important hybrid-state constraints.
// ============================================================================
/** [해설] 실제 player center가 움직일 수 있는 x 범위. hitbox 확장은 별도 함수에서 처리한다. */
function playerBounds(side) {
  return side === 'LEFT' ? [C.LEFT_MIN, C.LEFT_MAX] : [C.RIGHT_MIN, C.RIGHT_MAX];
}

/**
 * [해설] 추가 입력 없이 현재 수직 상태를 계속 진행했을 때의 y/vy/state 타임라인.
 * 상대 reachability에서는 불확실성을 상대에게 유리하게 잡아 shot 평가가 과도하게 낙관적이지 않게 한다.
 */
function neutralVerticalTimeline(p, vy, horizon) {
  // timeline[t] = state after t engine frames under neutral input.
  const out = [{ y: p.y, vy, state: p.state === 2 ? 1 : p.state }];
  let y = p.y;
  let v = vy;
  let st = p.state === 2 ? 1 : p.state;
  let lying = st === 4 ? -1 : -1; // unknown; conservative fast recovery
  for (let t = 1; t <= horizon; t++) {
    if (st === 4) {
      lying--;
      if (lying < -1) st = 0;
      out.push({ y, vy: v, state: st });
      continue;
    }
    const fy = y + v;
    y = fy;
    if (fy < C.PLAYER_GROUND_Y) v += 1;
    else if (fy > C.PLAYER_GROUND_Y) {
      v = 0;
      y = C.PLAYER_GROUND_Y;
      if (st === 3) { st = 4; lying = 3; }
      else st = 0;
    }
    out.push({ y, vy: v, state: st });
  }
  return out;
}

/** [해설] 현재 committed state에서 다시 평범한 지상 이동/점프를 시작할 수 있는 최초 frame을 추정한다. */
function firstGroundReadyFrame(p, vy, horizon) {
  if (p.state === 0) return 0;
  if (p.state === 4) return 1; // opponent-favorable uncertainty bound
  const tl = neutralVerticalTimeline(p, vy, horizon);
  for (let t = 1; t < tl.length; t++) {
    if (tl[t].state === 0 && tl[t].y === C.PLAYER_GROUND_Y) return t;
  }
  return horizon + 1;
}

/**
 * [해설] t프레임 뒤 player center가 도달 가능한 x 구간을 닫힌형식으로 계산한다.
 * walk에는 관성이 없으므로 full DP 없이도 충분하다. 기존 dive는 방향이 고정되고 recovery 후에만 walk freedom이 돌아온다.
 */
function horizontalInterval(p, vy, side, t) {
  const b = playerBounds(side);
  if (t <= 0) return [p.x, p.x];

  if (p.state === 3) {
    // During an existing dive, horizontal direction is committed. After the
    // dive + lying recovery, ordinary 6px/frame movement resumes.
    const tl = neutralVerticalTimeline(p, vy, t + 8);
    let x = p.x;
    let ready = null;
    for (let k = 1; k <= t; k++) {
      const prevState = tl[k - 1].state;
      if (prevState === 3) x += p.divingDirection * C.DIVE;
      x = clamp(x, b[0], b[1]);
      if (tl[k].state === 0 && ready == null) ready = k;
    }
    if (ready == null || ready >= t) return [x, x];
    const rem = (t - ready) * C.WALK;
    return [clamp(x - rem, b[0], b[1]), clamp(x + rem, b[0], b[1])];
  }

  if (p.state === 4) {
    const rem = max(0, t - 1) * C.WALK;
    return [clamp(p.x - rem, b[0], b[1]), clamp(p.x + rem, b[0], b[1])];
  }

  const r = t * C.WALK;
  return [clamp(p.x - r, b[0], b[1]), clamp(p.x + r, b[0], b[1])];
}

/** [해설] center reachable interval에 ±32 hitbox를 붙여 ball.x와 수평 겹침 가능 여부를 본다. */
function xIntervalHits(interval, x) {
  return x >= interval[0] - C.PLAYER_HALF && x <= interval[1] + C.PLAYER_HALF;
}

/**
 * [해설] 특정 시각 t에 ballY와 수직으로 겹칠 수 있는 경로 수의 근사치.
 * 현재 점프 계속, 지상 대기, 새 점프 시작을 모두 센다. 상대에게는 scheduler jitter까지 허용하는 낙관적 bound다.
 */
function jumpVerticalOptionsAt(p, vy, t, ballY, horizon) {
  let options = 0;
  const tl = neutralVerticalTimeline(p, vy, max(t, horizon || t));

  // Continuing the current committed vertical trajectory.
  const base = tl[min(t, tl.length - 1)];
  if (abs(ballY - base.y) <= C.PLAYER_HALF) options++;

  // Once grounded/recovered, a new jump may be started. We use every frame
  // rather than only 1/4/7... action-application phases: this is a deliberate
  // opponent-favorable bound and makes shot scoring robust to scheduler jitter.
  const ready = firstGroundReadyFrame(p, vy, t + 2);
  if (ready <= t && abs(ballY - C.PLAYER_GROUND_Y) <= C.PLAYER_HALF) options++;
  for (let start = ready + 1; start <= t; start++) {
    const age = t - start + 1;
    if (age < JUMP_TABLE.length && abs(ballY - JUMP_TABLE[age].y) <= C.PLAYER_HALF) options++;
  }
  return options;
}

/** [해설] 새 dive를 어느 frame에 시작해도 t에 공과 x/y hitbox가 겹칠 수 있는지 검사한다. */
function diveCanReachAt(p, side, t, bf) {
  if (p.state !== 0 || t <= 0 || bf.y < 150) return false;
  const b = playerBounds(side);
  for (let start = 1; start <= t; start++) {
    const age = t - start + 1;
    if (age >= DIVE_TABLE.length) continue;
    if (abs(bf.y - DIVE_TABLE[age].y) > C.PLAYER_HALF) continue;
    const pre = (start - 1) * C.WALK;
    const during = age === 1 ? C.WALK : C.WALK + (age - 1) * C.DIVE;
    const reach = pre + during + C.PLAYER_HALF;
    if (abs(bf.x - p.x) <= reach) {
      const lo = b[0] - C.PLAYER_HALF;
      const hi = b[1] + C.PLAYER_HALF;
      if (bf.x >= lo && bf.x <= hi) return true;
    }
  }
  return false;
}

/** [해설] 한 ball frame에 대한 최종 reachability 판정. walk/jump와 dive를 합친다. */
function canPlayerReachBallAt(p, vy, side, globalT, bf) {
  const xi = horizontalInterval(p, vy, side, globalT);
  if (!xIntervalHits(xi, bf.x)) {
    // A fresh dive can outrun ordinary walking horizontally.
    if (!diveCanReachAt(p, side, globalT, bf)) return { can: false, options: 0 };
  }

  const verticalOptions = jumpVerticalOptionsAt(p, vy, globalT, bf.y, globalT + 2);
  const dive = diveCanReachAt(p, side, globalT, bf);
  const options = verticalOptions + (dive ? 1 : 0);
  return { can: options > 0, options };
}

/**
 * [해설] 전체 공격 trajectory 중 상대가 처음 닿을 수 있는 시점과 총 contact opportunity를 집계한다.
 * v2의 핵심: landing 하나가 아니라 비행 전 구간을 평가한다.
 */
function interceptTrajectory(p, vy, side, tr, preFrames) {
  let earliest = 999;
  let totalOptions = 0;
  let earliestOptions = 0;
  for (let i = 0; i < tr.frames.length; i++) {
    const bf = tr.frames[i];
    const globalT = preFrames + i + 1;
    const r = canPlayerReachBallAt(p, vy, side, globalT, bf);
    if (r.can) {
      totalOptions += r.options;
      if (earliest === 999) {
        earliest = i + 1; // frames after the shot/contact
        earliestOptions = r.options;
      }
    }
    if (bf.ground) break;
  }
  return {
    canIntercept: earliest !== 999,
    earliest,
    earliestCount: earliestOptions,
    totalOpportunities: totalOptions,
  };
}

// ============================================================================
// [I] TRAJECTORY SCORING -- CUSHIONS ARE FIRST-CLASS, NOT SPECIAL CASES
// ============================================================================
/** [해설] wall/net cushion 이벤트에 작은 보너스를 주고, 상대 최초 요격 직전의 늦은 방향 반전은 추가 가점한다. */
function eventComplexityScore(tr, intercept) {
  let score = 0;
  let lastDirectionEventT = -1;
  for (let i = 0; i < tr.events.length; i++) {
    const e = tr.events[i];
    if (e.type === 'WALL_LEFT' || e.type === 'WALL_RIGHT') {
      score += CFG.SHOT_WALL_EVENT_BONUS;
      lastDirectionEventT = max(lastDirectionEventT, e.t);
    } else if (e.type === 'NET_TOP') {
      score += CFG.SHOT_NET_TOP_EVENT_BONUS;
    } else if (e.type === 'NET_SIDE_LEFT' || e.type === 'NET_SIDE_RIGHT') {
      score += CFG.SHOT_NET_SIDE_EVENT_BONUS;
      lastDirectionEventT = max(lastDirectionEventT, e.t);
    }
  }
  if (lastDirectionEventT > 0 && intercept.canIntercept && lastDirectionEventT >= intercept.earliest - 5) {
    score += CFG.SHOT_LATE_REVERSAL_BONUS;
  }
  return score;
}

/** [해설] 리드 시 약간 보수적, 뒤질 때 약간 공격적으로 shot score를 스케일한다. 큰 정책 전환이 아니라 미세 조정이다. */
function matchRiskScale(c) {
  const d = c.scoreSelf - c.scoreOpp;
  if (d >= CFG.LEAD_SAFE) return CFG.LEAD_RISK_SCALE;
  if (d <= CFG.TRAIL_AGGRO) return CFG.TRAIL_RISK_SCALE;
  return 1;
}

/**
 * [해설] 공격/clear trajectory의 공통 평가 함수.
 * 1) 자기 코트 landing은 거의 금지, 2) 상대가 전 구간에서 못 받으면 큰 점수,
 * 3) 받을 수 있으면 earliest intercept가 늦고 options가 적을수록 좋다,
 * 4) landing distance/edge/time/cushion을 작은 보조항으로 더한다.
 *
 * 현장 튜닝 시 가장 함부로 건드리면 안 되는 함수 중 하나. 새 스킬이 shot 가치만 바꾼다면 SKILL.evaluate에서 보정하는 편이 안전하다.
 */
function evaluateOutgoingTrajectory(tr, c, oppVy, contactFrame) {
  const land = trajectoryLanding(tr);
  if (!land) return { score: -1e9, intercept: null, landing: null };
  if (land.x <= C.NET_X) {
    return {
      score: -CFG.SHOT_SELF_SIDE_PENALTY - (C.NET_X - land.x) * 20,
      intercept: null,
      landing: land,
    };
  }

  const intercept = interceptTrajectory(c.opp, oppVy, 'RIGHT', tr, contactFrame);
  let score;
  if (!intercept.canIntercept) {
    score = CFG.SHOT_UNRETURNABLE;
  } else {
    score =
      CFG.SHOT_RETURN_BASE +
      intercept.earliest * CFG.SHOT_INTERCEPT_FRAME_WEIGHT -
      Math.log(1 + intercept.totalOpportunities) * CFG.SHOT_INTERCEPT_OPTIONS_WEIGHT * 8;
  }

  score += abs(land.x - c.opp.x) * CFG.SHOT_LANDING_DISTANCE_WEIGHT;
  if (min(abs(land.x - C.NET_X), abs(C.W - land.x)) < 45) score += CFG.SHOT_EDGE_WEIGHT * 45;
  score -= land.frames * CFG.SHOT_TIME_WEIGHT;
  score += eventComplexityScore(tr, intercept);
  score *= matchRiskScale(c);
  score += SKILL.evaluate(c, {
    type: 'OUTGOING_TRAJECTORY', trajectory: tr, landing: land, intercept, contactFrame,
  });

  return { score, intercept, landing: land };
}

// ============================================================================
// [J] POWER ATTACK PLANNER (AIRBORNE SELF)
// ============================================================================
/** [해설] 현재 self를 짧은 power-contact rollout용 exact-ish player state로 복제한다. state2 hidden delay는 가장 짧게 남았다고 가정해 보수적으로 평가한다. */
function cloneSelfExact(c, vy) {
  return {
    x: c.self.x, y: c.self.y, vy,
    state: c.self.state,
    frameNumber: c.self.frameNumber,
    divingDirection: c.self.divingDirection,
    // Snapshot omits state-2 delayBeforeNextFrame. Use the conservative
    // shortest remaining delay; if power still works under this assumption,
    // the real engine can only give us an equal-or-longer armed window.
    delay: 0,
    lying: -1,
    side: 'LEFT',
  };
}

/** [해설] 공개 player physics 순서를 재현하는 1-frame self simulator. power candidate 접촉 시점을 찾는 데 사용한다. */
function stepSelfExact(p, a) {
  if (p.state === 4) {
    p.lying--;
    if (p.lying < -1) p.state = 0;
    return;
  }
  let vx = 0;
  if (p.state < 5) vx = p.state < 3 ? a.x * C.WALK : p.divingDirection * C.DIVE;
  p.x = clamp(p.x + vx, C.LEFT_MIN, C.LEFT_MAX);

  if (p.state < 3 && a.y === -1 && p.y === C.PLAYER_GROUND_Y) {
    p.vy = C.JUMP_VY;
    p.state = 1;
    p.frameNumber = 0;
  }

  const fy = p.y + p.vy;
  p.y = fy;
  if (fy < C.PLAYER_GROUND_Y) p.vy += 1;
  else if (fy > C.PLAYER_GROUND_Y) {
    p.vy = 0; p.y = C.PLAYER_GROUND_Y; p.frameNumber = 0;
    if (p.state === 3) { p.state = 4; p.lying = 3; }
    else p.state = 0;
  }

  if (a.hit === 1) {
    if (p.state === 1) { p.state = 2; p.delay = 5; p.frameNumber = 0; }
    else if (p.state === 0 && a.x !== 0) {
      p.state = 3; p.divingDirection = a.x; p.vy = C.DIVE_VY; p.frameNumber = 0;
    }
  }

  if (p.state === 1) p.frameNumber = (p.frameNumber + 1) % 3;
  else if (p.state === 2) {
    if (p.delay < 1) {
      p.frameNumber++;
      if (p.frameNumber > 4) { p.frameNumber = 0; p.state = 1; }
    } else p.delay--;
  }
}

/** [해설] 엔진과 동일한 AABB collision geometry: |dx|<=32 && |dy|<=32. */
function playerBallOverlapRaw(b, p) {
  return abs(b.x - p.x) <= C.PLAYER_HALF && abs(b.y - p.y) <= C.PLAYER_HALF;
}


/**
 * [해설] 특정 {x,y,hit}를 지금 선택했을 때 실제로 언제 state2 collision이 생기는지 짧게 시뮬레이션한다.
 * ACTION_LATENCY 동안은 이전 held action이 적용된다는 점이 중요하다. 그 사이 이미 접촉해버리면 새 candidate는 무효다.
 * contact가 생기면 공을 full trajectory로 rollout하고 evaluateOutgoingTrajectory()로 점수화한다.
 */
function simulateImmediatePowerCandidate(c, selfVy, oppVy, candidate) {
  const b = cloneBall(c.ball);
  const p = cloneSelfExact(c, selfVy);
  let collisionFlag = playerBallOverlapRaw(b, p);

  // The current decision cannot affect the same physics frame that produced
  // this snapshot. Advance last held action for the configured latency.
  for (let t = 1; t <= CFG.ACTION_LATENCY; t++) {
    const bw = stepBallWorld(b, c.skill);
    stepSelfExact(p, MEM.lastAction);
    const ov = playerBallOverlapRaw(b, p);
    if (ov && !collisionFlag) return null; // contact already happened under old input
    collisionFlag = ov;
    if (bw.ground) return null;
  }

  const effectiveCandidate = c.self.state === 2
    ? action(candidate.x, candidate.y, 0)
    : candidate;

  for (let t = 1; t <= CFG.POWER_SEARCH_HOLD; t++) {
    const bw = stepBallWorld(b, c.skill);
    stepSelfExact(p, effectiveCandidate);
    const ov = playerBallOverlapRaw(b, p);
    if (ov && !collisionFlag) {
      const power = p.state === 2;
      if (!power) return null;
      const after = ordinaryCollisionFrom(b, p.x, true, effectiveCandidate.x, effectiveCandidate.y, true);
      const contactFrame = CFG.ACTION_LATENCY + t;
      const tr = simulateTrajectory(after, CFG.BALL_HORIZON, c.skill);
      const ev = evaluateOutgoingTrajectory(tr, c, oppVy, contactFrame);
      return {
        contactFrame,
        contactX: b.x,
        contactY: b.y,
        after,
        tr,
        score: ev.score,
        intercept: ev.intercept,
        action: effectiveCandidate,
      };
    }
    collisionFlag = ov;
    if (bw.ground) return null;
  }
  return null;
}

/** [해설] 공중에 있을 때 가능한 3x3 입력 중 power contact가 성립하는 후보를 실제 collision timing으로 비교한다. 너무 먼 하방 smash는 self-score 위험 때문에 사전 제거한다. */
function choosePowerAttack(c, selfVy, oppVy) {
  if (c.self.state !== 1 && c.self.state !== 2) return null;
  if (abs(c.ball.x - c.self.x) > CFG.POWER_NEAR_X || abs(c.ball.y - c.self.y) > CFG.POWER_NEAR_Y) return null;

  let best = null;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      if (y === 1 && C.NET_X - c.ball.x > CFG.DOWN_SMASH_MAX_NET_DISTANCE) continue;
      const cand = action(x, y, 1);
      const sim = simulateImmediatePowerCandidate(c, selfVy, oppVy, cand);
      if (!sim) continue;
      if (!best || sim.score > best.score) best = sim;
    }
  }
  if (!best) return null;
  return {
    type: 'POWER', x: best.action.x, y: best.action.y, hit: 1,
    score: best.score, contactFrame: best.contactFrame,
    debug: { intercept: best.intercept, events: best.tr.events },
  };
}

// ============================================================================
// [K] BODY RECEIVE + SELF-SET GEOMETRY
// ============================================================================
/** [해설] 새 결정이 적용되기 전 ACTION_LATENCY 동안 기존 x input으로 이동할 위치를 계산한다. */
function predictedSelfXAfterLatency(c) {
  let x = c.self.x;
  if (c.self.state < 3) x += MEM.lastAction.x * C.WALK * CFG.ACTION_LATENCY;
  return clamp(x, C.LEFT_MIN, C.LEFT_MAX);
}

/** [해설] 간단한 지상 수평 도달성 helper. 현재 v2.1의 핵심 ground planner는 first-contact simulation을 더 직접적으로 사용한다. */
/** [현재 미사용] 초기 v2 helper. field-day에서 임의로 활용하기 전 first-contact planner와 의미가 맞는지 확인할 것. */
function selfCanReachX(c, targetX, frames) {
  const x0 = predictedSelfXAfterLatency(c);
  const free = max(0, frames - CFG.ACTION_LATENCY);
  return abs(targetX - x0) <= C.WALK * free + C.PLAYER_HALF - 3;
}

/**
 * [해설] 특정 ball frame/playerX에서 몸으로 맞았다고 가정하고 그 이후를 평가한다.
 * 상대 코트로 넘어가면 CLEAR, 자기 코트에 남으면 제한적으로 SELF_SET, 그 외는 BAD_LOCAL.
 * self-set은 "좋은 샷"이 아니라 공격 기회를 만드는 보조 선택이므로 hard gate를 유지하는 것이 중요하다.
 */
function evaluateBodyContact(c, bf, playerX, contactFrame, oppVy) {
  if (abs(bf.x - playerX) < 3) return null; // avoid stochastic center branch
  const after = ordinaryCollisionFrom(bf, playerX, false, 0, 0, true);
  const tr = simulateTrajectory(after, CFG.BALL_HORIZON, c.skill);
  const land = trajectoryLanding(tr);
  if (!land) return null;

  if (land.x > C.NET_X) {
    const ev = evaluateOutgoingTrajectory(tr, c, oppVy, contactFrame);
    return { type: 'CLEAR', score: ev.score + 10, playerX, tr, landing: land };
  }

  const allowSelfSet =
    !MEM.selfSetUsed &&
    bf.x < CFG.SELF_SET_DEEP_BALL_X;
  if (allowSelfSet && land.x < C.NET_X - 8) {
    const score = CFG.SELF_SET_SCORE - abs(land.x - CFG.SELF_SET_TARGET_X) * 1.25 - land.frames * 0.25;
    return { type: 'SELF_SET', score, playerX, tr, landing: land };
  }

  return { type: 'BAD_LOCAL', score: -300 - abs(C.NET_X - land.x), playerX, tr, landing: land };
}

/**
 * [해설] 하나의 targetX를 계속 추적할 때 실제 sample-and-hold 입력으로 player.x가 어떻게 움직이는지 계산한다.
 * 새 action은 latency 뒤에 적용되고 그 후 3-frame 그룹마다 방향을 다시 고른다.
 */
function groundXTimelineToTarget(c, targetX, maxT) {
  const xs = [];
  let x = c.self.x;
  let heldX = MEM.lastAction.x;
  for (let t = 1; t <= maxT; t++) {
    // Current decision starts affecting physics after ACTION_LATENCY frames;
    // subsequent decisions refresh every TICK_GROUP frames.  The tactical
    // target remains the same, so only the held direction is resampled.
    if (
      t === CFG.ACTION_LATENCY + 1 ||
      (t > CFG.ACTION_LATENCY + 1 &&
        (t - (CFG.ACTION_LATENCY + 1)) % C.TICK_GROUP === 0)
    ) {
      heldX = moveToward(x, targetX);
    }
    x = clamp(x + heldX * C.WALK, C.LEFT_MIN, C.LEFT_MAX);
    xs.push(x);
  }
  return xs;
}

/**
 * [해설] v2.1 안정화의 핵심 함수. targetX로 가는 동안 "원하는 미래 접촉"이 아니라 엔진에서 최초로 생기는 AABB overlap을 찾는다.
 * world ground가 player collision보다 먼저 처리되므로 해당 frame에 ground면 contact로 세지 않는다.
 */
function firstGroundContactForTarget(c, freeTr, targetX, maxT) {
  const xs = groundXTimelineToTarget(c, targetX, maxT);
  for (let i = 0; i < min(maxT, freeTr.frames.length); i++) {
    const bf = freeTr.frames[i];
    if (bf.ground) return null; // world ground is processed before player collision
    const px = xs[i];
    if (
      abs(bf.x - px) <= C.PLAYER_HALF &&
      abs(bf.y - C.PLAYER_GROUND_Y) <= C.PLAYER_HALF
    ) {
      return { t: i + 1, bf, playerX: px };
    }
  }
  return null;
}

/**
 * [해설] 가능한 receive target들을 만들고, 각 target 경로의 FIRST actual contact만 평가한다.
 * v2의 touch-limit 자멸은 늦은 이상적 접촉을 점수화하면서 더 이른 실제 접촉을 놓친 것이 주요 원인이었다.
 * hitbox 가장자리 3px를 버리는 이유는 1-frame scheduler 변동에도 contact/miss가 뒤집히지 않게 하기 위해서다.
 */
function findBestGroundReceive(c, freeTr, oppVy) {
  let best = null;
  const limit = min(CFG.CONTACT_HORIZON, freeTr.frames.length);

  // Enumerate tactical target centers, but score the FIRST collision that the
  // actual held-action path would produce.  v2 previously scored an arbitrary
  // later ideal contact; in the real engine an earlier overlap can happen and
  // completely change vx / net-side bounce / touch count.
  const targets = new Set();
  for (let i = 0; i < limit; i++) {
    const bf = freeTr.frames[i];
    if (bf.x > C.NET_X + 8) continue;
    if (abs(bf.y - C.PLAYER_GROUND_Y) > C.PLAYER_HALF - 1) continue;
    for (let oi = 0; oi < CFG.RECEIVE_OFFSETS.length; oi++) {
      targets.add(clamp(bf.x - CFG.RECEIVE_OFFSETS[oi], C.LEFT_MIN, C.LEFT_MAX));
    }
  }

  for (const targetX of targets) {
    const hit = firstGroundContactForTarget(c, freeTr, targetX, limit);
    if (!hit) continue;
    // Avoid edge-of-hitbox plans: one scheduling frame of variation should not
    // flip a planned clear into a miss or reverse its outgoing geometry.
    if (abs(hit.bf.x - hit.playerX) > C.PLAYER_HALF - 3) continue;
    const ev = evaluateBodyContact(c, hit.bf, hit.playerX, hit.t, oppVy);
    if (!ev) continue;
    ev.score -= hit.t * 0.20 + abs(targetX - c.self.x) * 0.01;
    ev.contactFrame = hit.t;
    ev.ballFrame = hit.bf;
    ev.playerX = hit.playerX;
    ev.targetX = targetX;
    if (!best || ev.score > best.score) best = ev;
  }
  return best;
}

// ============================================================================
// [L] JUMP-TAKEOFF PLANNER
// ============================================================================
/** [해설] 지상에서 지금 점프했을 때 age 프레임 후 y를 테이블에서 읽는다. */
function jumpYAtAge(age) {
  if (age < 0 || age >= JUMP_TABLE.length) return C.PLAYER_GROUND_Y;
  return JUMP_TABLE[age].y;
}

/** [해설] 미래 jump contact에서 만들 수 있는 6개의 기본 power output(느림/빠름 x 상/직/하)을 공통 평가함수로 비교한다. */
function bestPowerValueFromContactBall(c, bf, contactFrame, oppVy) {
  let best = -1e9;
  for (const fast of [false, true]) {
    for (let y = -1; y <= 1; y++) {
      if (y === 1 && C.NET_X - bf.x > CFG.DOWN_SMASH_MAX_NET_DISTANCE) continue;
      const xIn = fast ? 1 : 0;
      // Use the same exact collision function as actual attack execution.
      const after = ordinaryCollisionFrom(bf, bf.x - 8, true, xIn, y, true);
      const tr = simulateTrajectory(after, CFG.BALL_HORIZON, c.skill);
      const ev = evaluateOutgoingTrajectory(tr, c, oppVy, contactFrame);
      if (ev.score > best) best = ev.score;
    }
  }
  return best;
}

/**
 * [해설] 현재 결정의 x가 최소 한 tick-group 동안 유지되는 sample-and-hold 제약을 반영한다.
 * -1/0/+1 중 무엇을 지금 누르면 이후 남은 walk freedom까지 포함해 contact 가능한지 slack으로 평가한다.
 */
function chooseHeldXForContact(xAfterLatency, bfX, moveFrames) {
  let bestX = 0;
  let bestSlack = -1e9;
  for (let x = -1; x <= 1; x++) {
    const held = min(C.TICK_GROUP, moveFrames);
    const x1 = clamp(xAfterLatency + x * C.WALK * held, C.LEFT_MIN, C.LEFT_MAX);
    const rem = max(0, moveFrames - held);
    const slack = rem * C.WALK + C.PLAYER_HALF - abs(bfX - x1);
    if (slack > bestSlack) { bestSlack = slack; bestX = x; }
  }
  return { x: bestX, slack: bestSlack };
}

/** [해설] 지금 점프를 시작했을 때 미래 ball frame과 jump arc가 겹치는 후보를 찾고, 그 접촉에서의 최선 공격 가치를 계산한다. ground receive보다 충분히 좋아야 실제 점프한다. */
function findJumpTakeoff(c, freeTr, oppVy) {
  if (c.self.state !== 0) return null;
  let best = null;

  const xAfterLatency = predictedSelfXAfterLatency(c);
  for (let i = CFG.ACTION_LATENCY; i < min(CFG.JUMP_MAX_CONTACT, freeTr.frames.length); i++) {
    const bf = freeTr.frames[i];
    const t = i + 1;
    if (bf.x > C.NET_X + 6) continue;
    const age = t - CFG.ACTION_LATENCY;
    const py = jumpYAtAge(age);
    if (abs(bf.y - py) > C.PLAYER_HALF - 2) continue;

    const moveFrames = max(0, t - CFG.ACTION_LATENCY);
    const heldChoice = chooseHeldXForContact(xAfterLatency, bf.x, moveFrames);
    if (heldChoice.slack < 0) continue;

    let value;
    if (t >= CFG.JUMP_POWER_MIN_CONTACT_FRAME) {
      value = bestPowerValueFromContactBall(c, bf, t, oppVy);
    } else {
      const px = clamp(bf.x - 10, C.LEFT_MIN, C.LEFT_MAX);
      const body = evaluateBodyContact(c, bf, px, t, oppVy);
      value = body ? body.score : -100;
    }

    value += max(0, 190 - bf.y) * 0.08;
    value -= t * 0.18;
    value += min(20, heldChoice.slack) * 0.25;
    if (!best || value > best.value) {
      best = {
        value, t,
        targetX: clamp(bf.x, C.LEFT_MIN, C.LEFT_MAX),
        moveX: heldChoice.x,
        ballFrame: bf,
      };
    }
  }
  return best;
}

/** [해설] 이미 점프한 뒤에는 ground planner로 돌아가지 않고 현재 점프 arc에 맞춰 x만 재계획한다. cushion으로 공 궤적이 바뀌어도 공중 commit을 끝까지 관리한다. */
function findAirborneIntercept(c, freeTr, selfVy) {
  if (c.self.state !== 1 && c.self.state !== 2) return null;
  const pseudo = { ...c.self, state: c.self.state === 2 ? 1 : c.self.state };
  const tl = neutralVerticalTimeline(pseudo, selfVy, min(24, freeTr.frames.length) + 2);
  let best = null;
  const limit = min(24, freeTr.frames.length);
  for (let i = 0; i < limit; i++) {
    const t = i + 1;
    const bf = freeTr.frames[i];
    if (bf.x > C.NET_X + 8 || bf.ground) continue;
    const py = tl[min(t, tl.length - 1)].y;
    if (abs(bf.y - py) > C.PLAYER_HALF - 2) continue;
    const heldChoice = chooseHeldXForContact(c.self.x, bf.x, t);
    if (heldChoice.slack < 0) continue;
    const score = 120 - t * 2 + min(20, heldChoice.slack) + max(0, 180 - bf.y) * 0.05;
    if (!best || score > best.score) {
      best = { t, targetX: clamp(bf.x, C.LEFT_MIN, C.LEFT_MAX), moveX: heldChoice.x, score };
    }
  }
  return best;
}

// ============================================================================
// [M] EMERGENCY DIVE
// ============================================================================
/**
 * [해설] walk로는 늦고 dive 거리에는 들어오는 저공 balls에만 emergency dive를 허용한다.
 * dive는 recovery cost가 크므로 공격 수단이 아니라 최후의 생존 수단으로 취급한다.
 */
function chooseDive(c, freeTr) {
  if (c.self.state !== 0) return null;
  const limit = min(CFG.DIVE_HORIZON, freeTr.frames.length);
  for (let i = 0; i < limit; i++) {
    const bf = freeTr.frames[i];
    const t = i + 1;
    if (bf.x >= C.NET_X || bf.y < CFG.DIVE_MIN_BALL_Y) continue;
    const dist = abs(bf.x - c.self.x) - C.PLAYER_HALF;
    const walk = C.WALK * max(0, t - CFG.ACTION_LATENCY);
    const dive = C.WALK * CFG.ACTION_LATENCY + C.DIVE * max(0, t - CFG.ACTION_LATENCY);
    if (dist > walk + CFG.DIVE_EXTRA_MARGIN && dist <= dive + CFG.DIVE_EXTRA_MARGIN) {
      return { type: 'DIVE', x: sign(bf.x - c.self.x) || 1, y: 0, hit: 1, contactFrame: t };
    }
  }
  return null;
}

// ============================================================================
// [N] OPPONENT CONTACT-FIRST THREAT GENERATION
// ============================================================================
/** [해설] 상대가 특정 contact frame에서 몸통 bump로 만들 수 있는 대표 궤적들을 생성한다. */
function bodyThreatsFromOpponentContact(c, bf, contactFrame, contactStates) {
  const out = [];
  const offsets = [-30, -20, -10, 10, 20, 30];
  for (let i = 0; i < offsets.length; i++) {
    const px = clamp(bf.x + offsets[i], C.RIGHT_MIN, C.RIGHT_MAX);
    if (abs(bf.x - px) > C.PLAYER_HALF || abs(bf.x - px) < 3) continue;
    const after = ordinaryCollisionFrom(bf, px, false, 0, 0, false);
    const tr = simulateTrajectory(after, CFG.BALL_HORIZON, c.skill);
    const land = trajectoryLanding(tr);
    if (land && land.x < C.NET_X) out.push({ type: 'OPP_BODY', contactFrame, tr, landing: land });
  }
  return out;
}

/** [해설] 상대 contact에서 가능한 6 power outputs를 생성한다. 실제 상대 정책을 맞히기보다 위협 envelope를 덮는 목적이다. */
function powerThreatsFromOpponentContact(c, bf, contactFrame) {
  const out = [];
  for (const fast of [false, true]) {
    for (let y = -1; y <= 1; y++) {
      const xIn = fast ? 1 : 0;
      const after = ordinaryCollisionFrom(bf, bf.x + 8, true, xIn, y, false);
      const tr = simulateTrajectory(after, CFG.BALL_HORIZON, c.skill);
      const land = trajectoryLanding(tr);
      if (land && land.x < C.NET_X) out.push({ type: 'OPP_POWER', contactFrame, tr, landing: land });
    }
  }
  return out;
}

/**
 * [해설] defense의 핵심은 현재 ball landing을 쫓는 것이 아니라 "상대의 가장 이른 미래 contact"부터 찾는 것이다.
 * earliest 근처의 contact window에서 body/power reply들을 생성하고 중복을 줄여 위협 집합을 만든다.
 */
function predictOpponentThreats(c, oppVy) {
  const freeTr = simulateTrajectory(c.ball, CFG.THREAT_HORIZON, c.skill);
  const contacts = [];
  let earliest = null;

  for (let i = 0; i < freeTr.frames.length; i++) {
    const bf = freeTr.frames[i];
    if (bf.x < C.NET_X - 5) break;
    const t = i + 1;
    const r = canPlayerReachBallAt(c.opp, oppVy, 'RIGHT', t, bf);
    if (r.can) {
      if (earliest == null) earliest = t;
      if (t <= earliest + CFG.DEFENSE_CONTACT_WINDOW) {
        // If the opponent can jump into this contact by t, treat a power hit
        // as possible. This intentionally over-approximates strong opponents.
        const airborne = jumpVerticalOptionsAt(c.opp, oppVy, t, bf.y, t + 2) > 0;
        contacts.push({ t, bf, airborne });
      }
    }
    if (earliest != null && t > earliest + CFG.DEFENSE_CONTACT_WINDOW) break;
  }

  const threats = [];
  for (let i = 0; i < contacts.length; i++) {
    const cc = contacts[i];
    const body = bodyThreatsFromOpponentContact(c, cc.bf, cc.t, null);
    for (let j = 0; j < body.length; j++) threats.push(body[j]);
    if (cc.airborne) {
      const power = powerThreatsFromOpponentContact(c, cc.bf, cc.t);
      for (let j = 0; j < power.length; j++) threats.push(power[j]);
    }
    if (threats.length >= CFG.DEFENSE_THREAT_LIMIT) break;
  }

  // Deduplicate by coarse signature; keep event-rich variants distinct.
  const map = new Map();
  for (let i = 0; i < threats.length; i++) {
    const th = threats[i];
    const first = th.tr.frames[0] || { vx: 0, vy: 0 };
    const sig = [Math.round(th.landing.x / 4), Math.round(first.vx), Math.round(first.vy), th.tr.events.map((e) => e.type).join(':')].join('|');
    if (!map.has(sig)) map.set(sig, th);
  }
  return Array.from(map.values()).slice(0, CFG.DEFENSE_THREAT_LIMIT);
}

// Fast analytic defender model used only to choose a standby X. The real
// incoming-ball planner later uses the exact current trajectory and contact
// geometry, so this function intentionally favors robustness over precision.
/**
 * [해설] 상대가 친 직후 우리 봇이 그 샷을 관측하고 새 action을 적용하기까지의 sample-and-hold lock을 계산한다.
 * contact가 snapshot frame과 겹치면 snapshot은 collision 전이므로 오히려 4-frame 뒤가 첫 informed action이다.
 */
function reactionLockAfterOpponentContact(contactFrame) {
  // Snapshot cadence is frames 3,6,9... relative to the snapshot that called
  // us. If the opponent contact happens on a snapshot frame, that snapshot
  // was taken BEFORE physics/collision, so the first informed action is four
  // frames later. Otherwise it is 3 or 2 frames later.
  const r = contactFrame % C.TICK_GROUP;
  return r === 0 ? 4 : 4 - r;
}

/** [해설] 특정 standby x에서 한 threat를 막을 수 있는지 빠르게 채점한다. lock 동안 유리한 반응 이동/점프를 금지해 빠른 하방샷을 과소평가하지 않는다. */
function groundStartInterceptScore(x0, tr, lockFrames) {
  let best = 999;
  for (let i = 0; i < tr.frames.length; i++) {
    const bf = tr.frames[i];
    const t = i + 1;
    // Before a fresh post-hit snapshot can produce a new action, the defender
    // is effectively committed to the position/motion chosen in advance. For
    // standby scoring we conservatively assume no helpful post-shot movement
    // during that locked window. This is what makes fast short shots and late
    // cushion reversals matter strategically rather than only geometrically.
    const xReach = C.WALK * max(0, t - lockFrames) + C.PLAYER_HALF;
    if (abs(bf.x - x0) > xReach) continue;

    if (abs(bf.y - C.PLAYER_GROUND_Y) <= C.PLAYER_HALF) {
      best = min(best, t);
      continue;
    }

    // A reactive jump also cannot start before the lock expires.
    for (let start = lockFrames + 1; start <= t; start++) {
      const age = t - start + 1;
      if (age < JUMP_TABLE.length && abs(bf.y - JUMP_TABLE[age].y) <= C.PLAYER_HALF) {
        best = min(best, t);
        break;
      }
    }
  }
  if (best === 999) return -CFG.DEFENSE_NO_INTERCEPT_PENALTY;
  return 100 - best * 4;
}

/**
 * [해설] 생성된 위협들에 대해 최악의 방어 가능성을 최대화하는 maximin standby X를 고른다.
 * 현재 버전에서 알려진 남은 약점: 후보 x까지 "상대 contact 전 실제로 도달 가능한가"가 hard constraint가 아니라 move cost로만 들어간다.
 * 현장 로그에서 fast vertical smash가 반복될 때 가장 먼저 점검할 곳이지만, v2.1 안정화에서는 regression 위험 때문에 구조를 유지했다.
 */
function chooseDefensiveStandby(c, oppVy, precomputedThreats) {
  const threats = precomputedThreats || predictOpponentThreats(c, oppVy);
  if (!threats.length) {
    // Mildly bias opposite the opponent's current position. This creates room
    // against both short and deep direct returns without committing to a wall.
    const bias = clamp((c.opp.x - 324) * -0.10, -14, 14);
    return clamp(CFG.HOME_X + bias, 72, 148);
  }

  let bestX = CFG.HOME_X;
  let bestWorst = -1e9;
  for (let x = C.LEFT_MIN; x <= C.LEFT_MAX; x += CFG.DEFENSE_X_STEP) {
    let worst = 1e9;
    for (let i = 0; i < threats.length; i++) {
      const th = threats[i];
      const lock = reactionLockAfterOpponentContact(th.contactFrame);
      const s = groundStartInterceptScore(x, th.tr, lock);
      if (s < worst) worst = s;
    }
    const moveCost = abs(x - c.self.x) * CFG.DEFENSE_MOVE_COST;
    const total = worst - moveCost;
    if (total > bestWorst) { bestWorst = total; bestX = x; }
  }
  return bestX;
}

// ============================================================================
// [O] TACTICAL PLANNER
// ============================================================================
/** [해설] deadband를 둔 1D steering. target 근처에서 좌우 떨림을 줄인다. */
function moveToward(x, target) {
  const d = target - x;
  if (abs(d) <= CFG.MOVE_DEADBAND) return 0;
  return d > 0 ? 1 : -1;
}

/**
 * [해설] 전술 우선순위의 중앙 dispatcher. 순서를 바꾸면 전략이 크게 변한다.
 * 우선순위: POWER -> committed neutral -> opponent-contact ANTICIPATE -> own-side receive/air/jump/dive -> opponent-side DEFEND.
 *
 * 중요한 설계 의도:
 * - 상대가 아직 공을 칠 수 있으면 현재 free trajectory는 곧 stale해지므로 irreversible jump를 금지한다.
 * - 이미 airborne이면 ground receive가 다시 개입하지 않는다.
 * - dive는 ground/jump가 실패한 뒤에만 등장한다.
 */
function planCore(c, selfVy, oppVy) {
  // 1) Airborne attack gets first refusal.
  const power = choosePowerAttack(c, selfVy, oppVy);
  if (power) return power;

  // Committed states: neutral is important because stale held hit/up inputs can
  // otherwise become a dive / re-jump immediately after recovery.
  if (c.self.state === 3 || c.self.state === 4 || c.self.state >= 5) {
    return { type: 'COMMITTED', x: 0, y: 0, hit: 0 };
  }

  const freeTr = simulateTrajectory(c.ball, CFG.BALL_HORIZON, c.skill);
  const land = trajectoryLanding(freeTr);
  if (!land) return { type: 'IDLE', x: 0, y: 0, hit: 0 };

  // Before committing to the current free trajectory, ask whether the opponent
  // can still touch the ball on their half. If yes, that trajectory is about
  // to become stale; jumping now is exactly the kind of irreversible mistake
  // a one-tick sampled controller must avoid.
  let imminentThreats = null;
  if (c.ball.x > C.NET_X + 2) {
    imminentThreats = predictOpponentThreats(c, oppVy);
    if (imminentThreats.length) {
      const standby = chooseDefensiveStandby(c, oppVy, imminentThreats);
      return { type: 'ANTICIPATE', x: moveToward(c.self.x, standby), y: 0, hit: 0, targetX: standby };
    }
  }

  // 2) If the free ball will remain / land on our side, solve the actual
  // incoming trajectory (including wall/net cushions) for contact.
  if (land.x < C.NET_X) {
    // Once airborne, never hand control back to the ground-receive planner.
    // Re-solve the current free trajectory against our actual jump arc. This
    // is crucial after a wall/net cushion changes the ball path mid-jump.
    if (c.self.state === 1 || c.self.state === 2) {
      const air = findAirborneIntercept(c, freeTr, selfVy);
      if (air) {
        return { type: 'AIR_INTERCEPT', x: air.moveX, y: 0, hit: 0, targetX: air.targetX, contactFrame: air.t, value: air.score };
      }
      return { type: 'AIR_RECOVER', x: moveToward(c.self.x, clamp(land.x, C.LEFT_MIN, C.LEFT_MAX)), y: 0, hit: 0 };
    }

    const ground = findBestGroundReceive(c, freeTr, oppVy);
    const jump = findJumpTakeoff(c, freeTr, oppVy);

    if (jump && (!ground || jump.value > ground.score + CFG.JUMP_MIN_VALUE_GAIN)) {
      return {
        type: 'JUMP_INTERCEPT',
        x: jump.moveX,
        y: -1,
        hit: 0,
        targetX: jump.targetX,
        contactFrame: jump.t,
        value: jump.value,
      };
    }

    if (!ground) {
      const dive = chooseDive(c, freeTr);
      if (dive) return dive;
    }

    if (ground) {
      return {
        type: ground.type,
        x: moveToward(c.self.x, ground.targetX == null ? ground.playerX : ground.targetX),
        y: 0,
        hit: 0,
        targetX: ground.targetX == null ? ground.playerX : ground.targetX,
        contactFrame: ground.contactFrame,
        value: ground.score,
      };
    }

    // Fallback tracks the actual incoming trajectory's landing, not a cached
    // landing value. Offset keeps ordinary body collision deterministic/netward.
    const fallbackX = clamp(land.x - 20, C.LEFT_MIN, C.LEFT_MAX);
    return { type: 'RECEIVE_FALLBACK', x: moveToward(c.self.x, fallbackX), y: 0, hit: 0, targetX: fallbackX };
  }

  // 3) Ball projects to opponent side. Predict opponent's contact first, roll
  // out their direct + cushion-capable replies, and choose a minimax standby.
  const standby = chooseDefensiveStandby(c, oppVy);
  return { type: 'DEFEND', x: moveToward(c.self.x, standby), y: 0, hit: 0, targetX: standby };
}

// ============================================================================
// [P] ACTION SAFETY EXECUTOR
// ============================================================================
/** [해설] held hit/up이 착지 후 unintended dive/re-jump로 변하는 것을 막기 위한 landing ETA 추정. */
function framesUntilLanding(p, vy) {
  if (p.state !== 1 && p.state !== 2 && p.state !== 3) return 999;
  let y = p.y;
  let v = vy;
  for (let t = 1; t <= 20; t++) {
    y += v;
    if (y < C.PLAYER_GROUND_Y) v += 1;
    else if (y > C.PLAYER_GROUND_Y) return t;
  }
  return 999;
}

/**
 * [해설] planner intent와 실제 engine action 사이의 마지막 safety gate.
 * ground에서 hit+x는 DIVE intent일 때만, y=-1은 JUMP_INTERCEPT일 때만 허용한다.
 * 공중에서도 POWER가 아니면 hit/up을 지우고, 착지 직전 POWER는 stale held input 위험 때문에 hit을 해제한다.
 * 이 함수는 tactical score보다 우선하는 invariant layer이므로 현장 수정 시 가능한 작게 유지한다.
 */
function executeSafely(c, planned, selfVy) {
  let a = action(planned.x, planned.y, planned.hit);
  const override = SKILL.emergencyOverride(c, planned);
  if (override) a = action(override.x, override.y, override.hit);

  if (c.self.state === 3 || c.self.state === 4 || c.self.state >= 5) return action(0, 0, 0);

  if (c.self.state === 0) {
    if (planned.type !== 'DIVE') a.hit = 0;
    if (planned.type !== 'JUMP_INTERCEPT' && a.y === -1) a.y = 0;
  } else if (c.self.state === 1 || c.self.state === 2) {
    if (planned.type !== 'POWER') {
      a.hit = 0;
      if (a.y === -1) a.y = 0;
    } else {
      if (framesUntilLanding(c.self, selfVy) <= CFG.LANDING_SAFETY_FRAMES) {
        a.hit = 0;
        if (a.y === -1) a.y = 0;
      }
      // state2 is already armed. y/x still matter at collision, hit does not.
      if (c.self.state === 2) a.hit = 0;
    }
  }

  a.x = a.x < 0 ? -1 : a.x > 0 ? 1 : 0;
  a.y = a.y < 0 ? -1 : a.y > 0 ? 1 : 0;
  a.hit = a.hit ? 1 : 0;
  return a;
}

/** [해설] DEBUG용 간략 로그. 실제 현장 분석에는 DEBUG_EXPORT + replay viewer가 더 유용하다. */
function debugLog(c, planned, a) {
  if (!CFG.DEBUG || MEM.decisions % CFG.DEBUG_EVERY !== 0) return;
  console.log('[PikaPlanner_v2]', {
    tick: c.tick,
    mode: planned.type,
    self: [c.self.x, c.self.y, c.self.state],
    opp: [c.opp.x, c.opp.y, c.opp.state],
    ball: [c.ball.x, c.ball.y, c.ball.vx, c.ball.vy],
    action: a,
    targetX: planned.targetX,
    value: planned.value || planned.score,
  });
}

// ============================================================================
// REQUIRED ENTRY POINT
// ============================================================================
/**
 * [해설] 대회가 호출하는 유일한 entry point.
 * 1) canonicalize -> 2) memory/state estimate -> 3) planCore -> 4) skill extra candidate ->
 * 5) self-set intent bookkeeping -> 6) executeSafely -> 7) debug export -> 8) uncanonicalize.
 * try/catch fallback은 전략적으로 강하지 않지만, 예외 하나로 Worker가 무력화되는 것보다 훨씬 낫다.
 */
function decide(snapshot) {
  const c = canonicalize(snapshot);
  MEM.decisions++;
  MEM.worldFlip = !!c.flip;
  updateMemory(c);

  const prevSelf = MEM.prev ? MEM.prev.self : null;
  const prevOpp = MEM.prev ? MEM.prev.opp : null;
  const selfVy = estimatePlayerVy(c.self, prevSelf);
  const oppVy = estimatePlayerVy(c.opp, prevOpp);

  let planned;
  try {
    planned = planCore(c, selfVy, oppVy);

    const extras = SKILL.extraActions(c) || [];
    if (extras.length) {
      let best = null;
      for (let i = 0; i < extras.length; i++) {
        const e = extras[i];
        const v = (typeof e.score === 'number' ? e.score : 0) + SKILL.evaluate(c, e);
        if (!best || v > best.v) best = { v, e };
      }
      if (best && best.v > 0) planned = best.e;
    }
  } catch (err) {
    if (CFG.DEBUG) console.warn('[PikaPlanner_v2] fallback', String(err));
    const target = c.ball.landingX < C.NET_X
      ? clamp(c.ball.landingX - 20, C.LEFT_MIN, C.LEFT_MAX)
      : C.HOME_X;
    planned = { type: 'FALLBACK', x: moveToward(c.self.x, target), y: 0, hit: 0, targetX: target };
  }

  if (planned && planned.type === 'SELF_SET' && planned.contactFrame != null) {
    const eta = c.tick + planned.contactFrame;
    if (MEM.selfSetPendingTick == null || eta < MEM.selfSetPendingTick) {
      MEM.selfSetPendingTick = eta;
    }
  }

  const canon = executeSafely(c, planned, selfVy);
  debugLog(c, planned, canon);
  if (CFG.DEBUG_EXPORT && typeof globalThis !== 'undefined') {
    globalThis.__PIKA_DEBUG_STATE__ = {
      tick: c.tick,
      mode: planned.type,
      targetX: planned.targetX == null ? null : planned.targetX,
      value: planned.value == null ? (planned.score == null ? null : planned.score) : planned.value,
      contactFrame: planned.contactFrame == null ? null : planned.contactFrame,
      action: cloneAction(canon),
      detail: planned.debug || null,
    };
  }
  MEM.lastAction = cloneAction(canon);
  MEM.prev = c;
  return uncanonicalize(canon, c.flip);
}
