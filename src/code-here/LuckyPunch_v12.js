'use strict';

/*
 * LuckyPunch v12 — aggressive rollout + adaptive predictive defense
 * ---------------------------------------------------------------------------
 * PikaPlanner tuned 공격 엔진을 기반으로, 상대의 미래 접촉점 네 개를 미리
 * 열거하는 수비와 세트 내 수비 신뢰도 선택을 결합한 LuckyPunch 버전.
 *
 * Design goals:
 *   1) Treat LEFT/RIGHT symmetrically by canonicalizing every state so that
 *      this bot always plays from the left half.
 *   2) Use the disclosed physics directly instead of smoothing or guessing.
 *   3) Plan around future player-ball contacts, not only landing positions.
 *   4) When airborne, enumerate power-hit choices and forward-simulate them.
 *   5) Keep the skill-facing area isolated so a tournament-day skill can be
 *      integrated without rewriting the core planner.
 *   6) Put an action-safety layer between the planner and the engine because
 *      actions are held until the next Worker result arrives.
 *
 * No imports, DOM, fetch, or files are used.  The file defines only globals
 * and the required top-level decide(snapshot) function.
 */

// ============================================================================
// [A] DISCLOSED ENGINE CONSTANTS -- DO NOT TUNE unless the organizers change
//     the engine itself.
// ============================================================================
const C = Object.freeze({
  GROUND_WIDTH: 432,
  NET_X: 216,
  PLAYER_HALF: 32,
  PLAYER_MIN_X: 32,
  PLAYER_MAX_X: 184, // canonical own side (always LEFT internally)
  OPP_MIN_X: 248,
  OPP_MAX_X: 400,
  PLAYER_GROUND_Y: 244,
  BALL_GROUND_Y: 252,
  NET_HALF_WIDTH: 25,
  NET_TOP_Y: 176,
  NET_BOTTOM_Y: 192,
  WALK_SPEED: 6,
  DIVE_SPEED: 8,
  JUMP_VY: -16,
  DIVE_VY: -5,
  GRAVITY: 1,
});

// ============================================================================
// [B] TUNABLE PARAMETERS -- safe place for offline/venue tuning.
//     tools/tune.mjs can inject runtime overrides in simulation.
//     tools/export_tuned_bot.mjs writes selected values into TUNED_CFG.
// ============================================================================
const DEFAULT_CFG = Object.freeze({
  MOVE_DEADBAND: 4,
  STANDBY_X: 108,
  BODY_RECEIVE_OFFSET: 25,
  BODY_RECEIVE_OFFSET_NEAR_NET: 18,

  BALL_HORIZON: 90,
  CONTACT_HORIZON: 42,
  JUMP_SEARCH_HORIZON: 22,
  ATTACK_SEARCH_FRAMES: 7,
  POWER_ARM_DISTANCE_X: 52,
  POWER_ARM_DISTANCE_Y: 56,

  // A power hit with y=+1 can self-score if contact is too far from the net.
  // The exact simulator rejects self-side landings anyway; this is an extra
  // prior that stops wasting candidate budget on obviously bad down-smashes.
  DOWN_SMASH_MAX_NET_DISTANCE: 92,

  // Defense / emergency thresholds.
  DIVE_MAX_LOOKAHEAD: 12,
  DIVE_MIN_BALL_Y: 170,
  DIVE_DISTANCE_MARGIN: 6,
  THREAT_CONTACT_DISTANCE: 64,

  // Shot evaluation weights.  Positive REACH_MARGIN means the opponent's
  // horizontal travel budget is insufficient by that many pixels.
  SHOT_BASE: 100,
  SHOT_REACH_MARGIN_WEIGHT: 2.2,
  SHOT_DISTANCE_WEIGHT: 0.30,
  SHOT_TIME_PRESSURE_WEIGHT: 28,
  SHOT_EDGE_BONUS_WEIGHT: 0.18,
  SHOT_OPP_COMMITTED_BONUS: 18,
  SHOT_OPP_LYING_BONUS: 45,
  SHOT_WALL_BOUNCE_BONUS: 3,

  // Contact planner preferences.
  JUMP_ATTACK_BONUS: 10,
  HIGH_CONTACT_BONUS: 12,
  CONTACT_LATE_PENALTY: 0.30,
  NORMAL_CLEAR_SAFETY_BONUS: 8,

  // Input is sampled every 3 engine frames and normally applies on the next
  // frame for a fast JS bot.  We deliberately avoid one-frame-only plans.
  EXPECTED_ACTION_LATENCY_FRAMES: 1,
  EXPECTED_HOLD_FRAMES: 3,
  LANDING_SAFETY_FRAMES: 2,

  // Match context.
  SCORE_LEAD_SAFE_THRESHOLD: 2,
  SCORE_TRAIL_AGGRESSIVE_THRESHOLD: -2,
  AHEAD_ATTACK_RISK_SCALE: 0.88,
  BEHIND_ATTACK_RISK_SCALE: 1.10,

  DEBUG: 0,
  DEBUG_EVERY_DECISIONS: 80,
});

// Values exported by tools/export_tuned_bot.mjs are written between markers.
// Keep the markers exactly as-is.
const TUNED_CFG = /* TUNED_CFG_START */ {
  "MOVE_DEADBAND": 7,
  "STANDBY_X": 109,
  "BODY_RECEIVE_OFFSET": 22,
  "BODY_RECEIVE_OFFSET_NEAR_NET": 13,
  "JUMP_SEARCH_HORIZON": 26,
  "POWER_ARM_DISTANCE_X": 63,
  "POWER_ARM_DISTANCE_Y": 72,
  "DOWN_SMASH_MAX_NET_DISTANCE": 79,
  "DIVE_MAX_LOOKAHEAD": 9,
  "SHOT_REACH_MARGIN_WEIGHT": 1.325,
  "SHOT_DISTANCE_WEIGHT": 0.269,
  "SHOT_TIME_PRESSURE_WEIGHT": 21.666,
  "JUMP_ATTACK_BONUS": 20.525,
  "CONTACT_LATE_PENALTY": 0.455
} /* TUNED_CFG_END */;
const RUNTIME_CFG =
  typeof globalThis !== 'undefined' && globalThis.__PIKA_CFG__
    ? globalThis.__PIKA_CFG__
    : null;
const CFG = Object.assign({}, DEFAULT_CFG, TUNED_CFG, RUNTIME_CFG || {});
var EARLY_DEF_TRUST = 0.5; // 낮은 모드: 조기 예측과 원래 중앙 대기의 혼합 비율
var DEF_ADAPTIVE = 1;
var defenseTrials = [0, 0]; // 0=중앙 혼합, 1=조기 예측 전량
var defenseWins = [0, 0];
var activeDefenseMode = 1;
var defensePrevSelf = -1;
var defensePrevOpp = -1;

function selectDefenseMode() {
  // 첫 랠리는 최신 공격에 강한 전량 예측, 다음 랠리는 중앙 혼합을 시험한다.
  if (defenseTrials[1] === 0) return 1;
  if (defenseTrials[0] === 0) return 0;
  const lowRate = defenseWins[0] / defenseTrials[0];
  const highRate = defenseWins[1] / defenseTrials[1];
  return highRate >= lowRate ? 1 : 0;
}

// ============================================================================
// [C] SKILL ADAPTER -- TOURNAMENT-DAY PRIMARY EDIT AREA
//
// The unreleased skill should be integrated here first.  The core planner
// below only asks this adapter five questions:
//   read()            -> normalize new snapshot fields
//   transformState()  -> physics/state modifiers
//   extraActions()    -> additional tactical actions
//   evaluate()        -> value/cost of holding/using the skill
//   emergencyOverride()-> final last-resort action override
//
// For a new skill, classify it first:
//   - new action       -> extraActions / emergencyOverride
//   - physics change  -> transformState and the simulator hook below
//   - reachability    -> transformReachability
//   - gauge/cooldown  -> evaluate
// ============================================================================
const SKILL = {
  read(s) {
    // Example after skill reveal (replace only when real field names exist):
    // return {
    //   selfGauge: s.self.skillGauge ?? 0,
    //   oppGauge: s.opp.skillGauge ?? 0,
    //   selfActive: !!s.self.skillActive,
    //   oppActive: !!s.opp.skillActive,
    // };
    return Object.freeze({ enabled: false });
  },

  transformState(ctx) {
    return ctx;
  },

  transformReachability(reachInfo, _ctx, _who) {
    return reachInfo;
  },

  extraActions(_ctx) {
    return [];
  },

  simulateBallHook(_ball, _skillState) {
    // If a skill changes ball physics, mutate the simulated ball here in the
    // exact same frame order as the released implementation.
  },

  evaluate(_ctx, _candidate) {
    // Positive = skill/resource situation makes this candidate better.
    // Negative = preserve gauge/cooldown instead.
    return 0;
  },

  emergencyOverride(_ctx, _plannedAction) {
    return null;
  },
};

// ============================================================================
// [D] GLOBAL STATE ESTIMATOR
// ============================================================================
const MEM = {
  decisions: 0,
  prev: null,
  lastCanonAction: { x: 0, y: 0, hit: 0 },
  lastScoreSelf: 0,
  lastScoreOpp: 0,
  ownTouchEstimate: 0,
  oppTouchEstimate: 0,
  selfSetUsed: false,
  lastBallVx: null,
  lastBallVy: null,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

function abs(v) {
  return v < 0 ? -v : v;
}

function cloneAction(a) {
  return { x: a.x | 0, y: a.y | 0, hit: a.hit | 0 };
}

function canonicalize(s) {
  const flip = s.side === 'RIGHT';
  const fx = (x) => (flip ? C.GROUND_WIDTH - x : x);
  const fvx = (vx) => (flip ? -vx : vx);

  const out = {
    flip,
    tick: s.tick,
    self: {
      x: fx(s.self.x),
      y: s.self.y,
      state: s.self.state,
      frameNumber: s.self.frameNumber,
      divingDirection: flip ? -s.self.divingDirection : s.self.divingDirection,
    },
    opp: {
      x: fx(s.opp.x),
      y: s.opp.y,
      state: s.opp.state,
      frameNumber: s.opp.frameNumber,
      divingDirection: flip ? -s.opp.divingDirection : s.opp.divingDirection,
    },
    ball: {
      x: fx(s.ball.x),
      y: s.ball.y,
      vx: fvx(s.ball.xVelocity),
      vy: s.ball.yVelocity,
      isPowerHit: !!s.ball.isPowerHit,
      landingX: fx(s.ball.expectedLandingPointX),
    },
    scoreSelf: s.meta.score.self,
    scoreOpp: s.meta.score.opp,
    isPlayer2Serve: !!s.meta.isPlayer2Serve,
    rallyFrameCount: s.meta.rallyFrameCount,
    tickFrameGroupSize: s.config.tickFrameGroupSize,
    skill: SKILL.read(s),
  };
  return SKILL.transformState(out);
}

function uncanonicalizeAction(a, flip) {
  return { x: flip ? -a.x : a.x, y: a.y, hit: a.hit };
}

// Jump trajectory table.  Index n means state AFTER n jump frames have run;
// index 0 is the grounded state immediately before the jump input is applied.
const JUMP_TABLE = (() => {
  const arr = [{ y: C.PLAYER_GROUND_Y, vy: 0 }];
  let y = C.PLAYER_GROUND_Y;
  let vy = C.JUMP_VY;
  for (let i = 1; i <= 40; i++) {
    y += vy;
    if (y < C.PLAYER_GROUND_Y) {
      vy += C.GRAVITY;
    } else if (y > C.PLAYER_GROUND_Y) {
      y = C.PLAYER_GROUND_Y;
      vy = 0;
    }
    arr.push({ y, vy });
    if (i > 1 && y === C.PLAYER_GROUND_Y) break;
  }
  return arr;
})();

const DIVE_TABLE = (() => {
  // index 0 = state immediately after dive activation frame: y still 244,
  // but vertical velocity has just been set to -5.
  const arr = [{ y: C.PLAYER_GROUND_Y, vy: C.DIVE_VY }];
  let y = C.PLAYER_GROUND_Y;
  let vy = C.DIVE_VY;
  for (let i = 1; i <= 30; i++) {
    y += vy;
    if (y < C.PLAYER_GROUND_Y) {
      vy += C.GRAVITY;
    } else if (y > C.PLAYER_GROUND_Y) {
      y = C.PLAYER_GROUND_Y;
      vy = 0;
    }
    arr.push({ y, vy });
    if (i > 1 && y === C.PLAYER_GROUND_Y) break;
  }
  return arr;
})();

function chooseVyFromTable(table, y, prevY, fallbackVy) {
  let best = null;
  let bestCost = 1e9;
  const trend = prevY == null ? 0 : sign(y - prevY); // -1 rising, +1 falling
  for (let i = 0; i < table.length; i++) {
    if (table[i].y !== y) continue;
    const vy = table[i].vy;
    let cost = 0;
    if (trend < 0 && vy > 0) cost += 100;
    if (trend > 0 && vy <= 0) cost += 100;
    if (fallbackVy != null) cost += abs(vy - fallbackVy) * 0.1;
    if (cost < bestCost) {
      bestCost = cost;
      best = vy;
    }
  }
  if (best != null) return best;

  // Snapshot cadence is three frames, so exotic state transitions can leave
  // us between table-identifiable points.  A finite-difference fallback is
  // intentionally conservative.
  if (prevY != null) return clamp(Math.round((y - prevY) / 3), -16, 16);
  return fallbackVy == null ? 0 : fallbackVy;
}

function estimatePlayerVy(p, prevP) {
  if (p.state === 0 || p.state === 4 || p.state >= 5) return 0;
  const prevY = prevP ? prevP.y : null;
  if (p.state === 3) {
    return chooseVyFromTable(DIVE_TABLE, p.y, prevY, C.DIVE_VY);
  }
  return chooseVyFromTable(JUMP_TABLE, p.y, prevY, -4);
}

function updateTouchEstimates(c) {
  const scoreChanged =
    c.scoreSelf !== MEM.lastScoreSelf || c.scoreOpp !== MEM.lastScoreOpp;
  if (scoreChanged) {
    MEM.ownTouchEstimate = 0;
    MEM.oppTouchEstimate = 0;
    MEM.selfSetUsed = false;
  }

  if (MEM.prev) {
    // Crossing the net is the real touch-limit reset criterion.
    const prevLeft = MEM.prev.ball.x < C.NET_X;
    const nowLeft = c.ball.x < C.NET_X;
    if (prevLeft !== nowLeft) {
      MEM.ownTouchEstimate = 0;
      MEM.oppTouchEstimate = 0;
      MEM.selfSetUsed = false;
    }

    // A sharp velocity change while the ball is close to a player is a useful
    // approximation of a contact.  This is deliberately not used for safety-
    // critical decisions; it only informs future self-set extensions.
    const velocityChanged =
      MEM.lastBallVx != null &&
      (c.ball.vx !== MEM.lastBallVx || c.ball.vy !== MEM.lastBallVy);
    if (velocityChanged) {
      const nearSelf =
        abs(c.ball.x - c.self.x) <= C.PLAYER_HALF + 6 &&
        abs(c.ball.y - c.self.y) <= C.PLAYER_HALF + 8;
      const nearOpp =
        abs(c.ball.x - c.opp.x) <= C.PLAYER_HALF + 6 &&
        abs(c.ball.y - c.opp.y) <= C.PLAYER_HALF + 8;
      if (nearSelf) {
        MEM.ownTouchEstimate++;
        if (c.ball.x < C.NET_X) MEM.selfSetUsed = true;
      }
      if (nearOpp) MEM.oppTouchEstimate++;
    }
  }

  MEM.lastScoreSelf = c.scoreSelf;
  MEM.lastScoreOpp = c.scoreOpp;
  MEM.lastBallVx = c.ball.vx;
  MEM.lastBallVy = c.ball.vy;
}

// ============================================================================
// [E] EXACT / NEAR-EXACT PHYSICS SIMULATOR
// ============================================================================
function cloneBall(b) {
  return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, isPowerHit: !!b.isPowerHit };
}

function clonePlayer(p, estimatedVy) {
  return {
    x: p.x,
    y: p.y,
    vy: estimatedVy,
    state: p.state,
    frameNumber: p.frameNumber | 0,
    divingDirection: p.divingDirection | 0,
    lyingLeft: p.state === 4 ? 2 : -1,
    delay: p.state === 2 ? 3 : 0,
  };
}

function ballPlayerOverlap(ball, player) {
  return (
    abs(ball.x - player.x) <= C.PLAYER_HALF &&
    abs(ball.y - player.y) <= C.PLAYER_HALF
  );
}

function stepBallWorld(ball, skillState) {
  const futureX = ball.x + ball.vx;
  if (futureX < 0 || futureX > C.GROUND_WIDTH) {
    ball.vx = -ball.vx;
  }

  let futureY = ball.y + ball.vy;
  if (futureY < 0) {
    ball.vy = 1;
  }

  if (abs(ball.x - C.NET_X) < C.NET_HALF_WIDTH && ball.y > C.NET_TOP_Y) {
    if (ball.y <= C.NET_BOTTOM_Y) {
      if (ball.vy > 0) ball.vy = -ball.vy;
    } else {
      if (ball.x < C.NET_X) ball.vx = -abs(ball.vx);
      else ball.vx = abs(ball.vx);
    }
  }

  SKILL.simulateBallHook(ball, skillState);

  futureY = ball.y + ball.vy;
  if (futureY > C.BALL_GROUND_Y) {
    ball.vy = -ball.vy;
    ball.y = C.BALL_GROUND_Y;
    return true;
  }

  ball.y = futureY;
  ball.x += ball.vx;
  ball.vy += C.GRAVITY;
  return false;
}

function stepPlayer(player, action) {
  if (player.state === 4) {
    player.lyingLeft -= 1;
    if (player.lyingLeft < -1) player.state = 0;
    return;
  }

  let vx = 0;
  if (player.state < 5) {
    if (player.state < 3) vx = action.x * C.WALK_SPEED;
    else vx = player.divingDirection * C.DIVE_SPEED;
  }
  player.x = clamp(player.x + vx, C.PLAYER_MIN_X, C.PLAYER_MAX_X);

  if (
    player.state < 3 &&
    action.y === -1 &&
    player.y === C.PLAYER_GROUND_Y
  ) {
    player.vy = C.JUMP_VY;
    player.state = 1;
    player.frameNumber = 0;
  }

  const futureY = player.y + player.vy;
  player.y = futureY;
  if (futureY < C.PLAYER_GROUND_Y) {
    player.vy += C.GRAVITY;
  } else if (futureY > C.PLAYER_GROUND_Y) {
    player.vy = 0;
    player.y = C.PLAYER_GROUND_Y;
    player.frameNumber = 0;
    if (player.state === 3) {
      player.state = 4;
      player.lyingLeft = 3;
    } else {
      player.state = 0;
    }
  }

  if (action.hit === 1) {
    if (player.state === 1) {
      player.delay = 5;
      player.frameNumber = 0;
      player.state = 2;
    } else if (player.state === 0 && action.x !== 0) {
      player.state = 3;
      player.frameNumber = 0;
      player.divingDirection = action.x;
      player.vy = C.DIVE_VY;
    }
  }

  if (player.state === 1) {
    player.frameNumber = (player.frameNumber + 1) % 3;
  } else if (player.state === 2) {
    if (player.delay < 1) {
      player.frameNumber += 1;
      if (player.frameNumber > 4) {
        player.frameNumber = 0;
        player.state = 1;
      }
    } else {
      player.delay -= 1;
    }
  }
}

function collideBallWithPlayer(ball, player, action) {
  if (ball.x < player.x) {
    ball.vx = -Math.floor(abs(ball.x - player.x) / 3);
  } else if (ball.x > player.x) {
    ball.vx = Math.floor(abs(ball.x - player.x) / 3);
  }

  // Exact-center body contacts are stochastic in the real engine.  In our
  // planner we use 0 as the neutral branch and avoid deliberately targeting
  // this geometry; the tournament engine itself will supply the random value.
  if (ball.vx === 0) ball.vx = 0;

  const av = abs(ball.vy);
  ball.vy = -av;
  if (av < 15) ball.vy = -15;

  if (player.state === 2) {
    ball.vx = (abs(action.x) + 1) * 10;
    // Canonical self is always on the LEFT, so power hits go to +x.
    ball.vy = abs(ball.vy) * action.y * 2;
    ball.isPowerHit = true;
  } else {
    ball.isPowerHit = false;
  }
}

function simulateFreeTrajectory(ball0, maxFrames, skillState) {
  const ball = cloneBall(ball0);
  const out = [];
  let wallBounces = 0;
  let prevVx = ball.vx;
  for (let t = 1; t <= maxFrames; t++) {
    const ground = stepBallWorld(ball, skillState);
    if (ball.vx !== prevVx && (ball.x < 25 || ball.x > C.GROUND_WIDTH - 25)) {
      wallBounces++;
    }
    prevVx = ball.vx;
    out.push({
      t,
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      ground,
    });
    if (ground) break;
  }
  return { frames: out, wallBounces };
}

function landingInfo(ball0, skillState) {
  const tr = simulateFreeTrajectory(ball0, CFG.BALL_HORIZON, skillState);
  if (!tr.frames.length) return null;
  const last = tr.frames[tr.frames.length - 1];
  return {
    x: last.x,
    frames: last.t,
    wallBounces: tr.wallBounces,
    trajectory: tr.frames,
  };
}

function predictedLandingWithinFrames(player) {
  if (player.state !== 1 && player.state !== 2) return 999;
  let y = player.y;
  let vy = player.vy;
  for (let t = 1; t <= 12; t++) {
    const fy = y + vy;
    y = fy;
    if (fy < C.PLAYER_GROUND_Y) vy += 1;
    else if (fy > C.PLAYER_GROUND_Y) return t;
  }
  return 999;
}

// ============================================================================
// [F] REACHABILITY / CONTACT PLANNING
// ============================================================================
function intervalDistance(x, lo, hi) {
  if (x < lo) return lo - x;
  if (x > hi) return x - hi;
  return 0;
}

function horizontalReachDistance(playerState, frames) {
  if (frames <= 0) return 0;
  if (playerState === 4) return Math.max(0, frames - 3) * C.WALK_SPEED;
  if (playerState === 3) return frames * C.DIVE_SPEED;
  return frames * C.WALK_SPEED;
}

function opponentReachMargin(landing, opp) {
  const frames = Math.max(1, landing.frames - CFG.EXPECTED_ACTION_LATENCY_FRAMES);
  const targetLo = clamp(landing.x - C.PLAYER_HALF, C.OPP_MIN_X, C.OPP_MAX_X);
  const targetHi = clamp(landing.x + C.PLAYER_HALF, C.OPP_MIN_X, C.OPP_MAX_X);
  const dist = intervalDistance(opp.x, Math.min(targetLo, targetHi), Math.max(targetLo, targetHi));
  let reach = horizontalReachDistance(opp.state, frames);
  const transformed = SKILL.transformReachability(
    { distance: dist, reach, frames },
    null,
    'opp'
  );
  reach = transformed && typeof transformed.reach === 'number' ? transformed.reach : reach;
  return dist - reach;
}

function playerJumpYAtAge(age) {
  if (age < 0 || age >= JUMP_TABLE.length) return C.PLAYER_GROUND_Y;
  return JUMP_TABLE[age].y;
}

function findJumpNowContact(c, ballTrajectory) {
  if (c.self.state !== 0) return null;

  let best = null;
  const latency = CFG.EXPECTED_ACTION_LATENCY_FRAMES;
  const maxT = Math.min(CFG.JUMP_SEARCH_HORIZON, ballTrajectory.length);
  for (let t = latency + 1; t <= maxT; t++) {
    const bf = ballTrajectory[t - 1];
    if (!bf || bf.ground || bf.x > C.NET_X + 4) continue;

    const age = t - latency;
    const py = playerJumpYAtAge(age);
    const yGap = abs(bf.y - py);
    if (yGap > C.PLAYER_HALF - 2) continue;

    const desiredX = clamp(bf.x, C.PLAYER_MIN_X, C.PLAYER_MAX_X);
    const moveFrames = Math.max(0, t - latency);
    const maxDx = C.WALK_SPEED * moveFrames + C.PLAYER_HALF - 3;
    const dx = abs(desiredX - c.self.x);
    if (dx > maxDx) continue;

    const highBonus = Math.max(0, (190 - bf.y) * 0.08);
    const score =
      CFG.JUMP_ATTACK_BONUS +
      highBonus -
      t * CFG.CONTACT_LATE_PENALTY -
      dx * 0.02;
    if (!best || score > best.score) {
      best = { t, x: desiredX, y: py, ball: bf, score };
    }
  }
  return best;
}

function chooseBodyContactGeometry(c, bf) {
  const offsets = [9, 12, 18, 25, 30];
  const selfSetAllowed =
    !MEM.selfSetUsed &&
    MEM.ownTouchEstimate <= 1 &&
    bf.x < 132;
  let best = null;

  for (const requestedOffset of offsets) {
    const playerX = clamp(
      bf.x - requestedOffset,
      C.PLAYER_MIN_X,
      C.PLAYER_MAX_X
    );
    if (abs(bf.x - playerX) > C.PLAYER_HALF) continue;
    if (abs(bf.x - playerX) < 3) continue; // avoid vx==0 random branch

    const b = { x: bf.x, y: bf.y, vx: bf.vx, vy: bf.vy, isPowerHit: false };
    const p = { x: playerX, y: C.PLAYER_GROUND_Y, state: 0 };
    collideBallWithPlayer(b, p, { x: 0, y: 0, hit: 0 });
    const land = landingInfo(b, c.skill);
    if (!land) continue;

    let score;
    let type;
    if (selfSetAllowed && land.x < C.NET_X - 10) {
      // One controlled self-set is valuable when a deep receive can be moved
      // into a near-net attacking zone.  Aim around x=168~180 rather than
      // hugging the pillar.
      score = 140 - abs(land.x - 174) * 1.4 - land.frames * 0.15;
      type = 'SELF_SET';
    } else if (land.x > C.NET_X) {
      const margin = opponentReachMargin(land, c.opp);
      score = 95 + margin * 0.7 + abs(land.x - c.opp.x) * 0.12;
      type = 'CLEAR';
    } else {
      score = -80 - abs(C.NET_X - land.x);
      type = 'BAD_LOCAL';
    }

    if (!best || score > best.score) {
      best = { playerX, requestedOffset, landing: land, score, type };
    }
  }
  return best;
}

function findGroundContact(c, ballTrajectory) {
  let best = null;
  const maxT = Math.min(CFG.CONTACT_HORIZON, ballTrajectory.length);
  for (let t = 1; t <= maxT; t++) {
    const bf = ballTrajectory[t - 1];
    if (!bf || bf.x > C.NET_X + 8) continue;
    if (abs(bf.y - C.PLAYER_GROUND_Y) > C.PLAYER_HALF - 2) continue;

    const geometry = chooseBodyContactGeometry(c, bf);
    const fallbackOffset =
      bf.x > C.NET_X - 65
        ? CFG.BODY_RECEIVE_OFFSET_NEAR_NET
        : CFG.BODY_RECEIVE_OFFSET;
    const desiredX = geometry
      ? geometry.playerX
      : clamp(bf.x - fallbackOffset, C.PLAYER_MIN_X, C.PLAYER_MAX_X);
    const moveFrames = Math.max(0, t - CFG.EXPECTED_ACTION_LATENCY_FRAMES);
    const dx = abs(desiredX - c.self.x);
    if (dx > C.WALK_SPEED * moveFrames + C.PLAYER_HALF - 5) continue;

    const score =
      CFG.NORMAL_CLEAR_SAFETY_BONUS -
      t * CFG.CONTACT_LATE_PENALTY -
      dx * 0.01;
    if (!best || score > best.score) best = { t, x: desiredX, ball: bf, score, geometry };
  }
  return best;
}

function canNormalReachLanding(c, landing) {
  const frames = Math.max(0, landing.frames - CFG.EXPECTED_ACTION_LATENCY_FRAMES);
  const target = clamp(
    landing.x - CFG.BODY_RECEIVE_OFFSET,
    C.PLAYER_MIN_X,
    C.PLAYER_MAX_X
  );
  return abs(target - c.self.x) <= C.WALK_SPEED * frames + C.PLAYER_HALF;
}

function chooseEmergencyDive(c, landing) {
  if (c.self.state !== 0) return null;
  if (landing.x >= C.NET_X || landing.frames > CFG.DIVE_MAX_LOOKAHEAD) return null;
  const currentBallLow = c.ball.y >= CFG.DIVE_MIN_BALL_Y || c.ball.vy > 8;
  if (!currentBallLow) return null;

  const target = clamp(landing.x, C.PLAYER_MIN_X, C.PLAYER_MAX_X);
  const dist = abs(target - c.self.x) - C.PLAYER_HALF;
  const walkReach = C.WALK_SPEED * Math.max(0, landing.frames - 1);
  const diveReach = C.DIVE_SPEED * Math.max(0, landing.frames - 1) + 6;
  if (
    dist > walkReach + CFG.DIVE_DISTANCE_MARGIN &&
    dist <= diveReach + CFG.DIVE_DISTANCE_MARGIN
  ) {
    return { type: 'DIVE', x: sign(target - c.self.x) || 1, y: 0, hit: 1 };
  }
  return null;
}

// ============================================================================
// [G] POWER-HIT ROLLOUT / SHOT EVALUATION
// ============================================================================
function shotRiskScale(c) {
  const diff = c.scoreSelf - c.scoreOpp;
  if (diff >= CFG.SCORE_LEAD_SAFE_THRESHOLD) return CFG.AHEAD_ATTACK_RISK_SCALE;
  if (diff <= CFG.SCORE_TRAIL_AGGRESSIVE_THRESHOLD)
    return CFG.BEHIND_ATTACK_RISK_SCALE;
  return 1.0;
}

function evaluateShot(ballAfter, opp, c) {
  const landing = landingInfo(ballAfter, c.skill);
  if (!landing) return -1e9;
  if (landing.x <= C.NET_X) return -100000 - (C.NET_X - landing.x) * 10;

  const reachMargin = opponentReachMargin(landing, opp);
  const dist = abs(landing.x - opp.x);
  const timePressure = 1 / Math.max(2, landing.frames);
  const edgeDist = Math.min(abs(landing.x - C.NET_X), abs(C.GROUND_WIDTH - landing.x));
  const edgeBonus = Math.max(0, 60 - edgeDist);

  let committedBonus = 0;
  if (opp.state === 3) committedBonus += CFG.SHOT_OPP_COMMITTED_BONUS;
  if (opp.state === 4) committedBonus += CFG.SHOT_OPP_LYING_BONUS;

  let score =
    CFG.SHOT_BASE +
    reachMargin * CFG.SHOT_REACH_MARGIN_WEIGHT +
    dist * CFG.SHOT_DISTANCE_WEIGHT +
    timePressure * CFG.SHOT_TIME_PRESSURE_WEIGHT * 20 +
    edgeBonus * CFG.SHOT_EDGE_BONUS_WEIGHT +
    committedBonus +
    landing.wallBounces * CFG.SHOT_WALL_BOUNCE_BONUS;

  // When leading, penalize shots whose reach margin is negative (easy return)
  // less aggressively than self-score risk; when trailing, reward aggressive
  // positive-margin shots slightly more.
  score *= shotRiskScale(c);
  score += SKILL.evaluate(c, { type: 'SHOT', landing, ballAfter });
  return score;
}

function simulatePowerCandidate(c, candidate, estimatedSelfVy) {
  const ball = cloneBall(c.ball);
  const player = clonePlayer(c.self, estimatedSelfVy);
  let collisionFlag = ballPlayerOverlap(ball, player);

  // New Worker result cannot affect the same engine frame that produced the
  // snapshot.  Advance the disclosed previous action for the expected latency.
  for (let d = 0; d < CFG.EXPECTED_ACTION_LATENCY_FRAMES; d++) {
    const ground = stepBallWorld(ball, c.skill);
    stepPlayer(player, MEM.lastCanonAction);
    const overlap = ballPlayerOverlap(ball, player);
    if (overlap && !collisionFlag) {
      collideBallWithPlayer(ball, player, MEM.lastCanonAction);
      collisionFlag = true;
      // Contact already happened before candidate application.
      return null;
    }
    if (!overlap) collisionFlag = false;
    if (ground) return null;
  }

  const hold = Math.max(CFG.EXPECTED_HOLD_FRAMES, CFG.ATTACK_SEARCH_FRAMES);
  for (let t = 1; t <= hold; t++) {
    const ground = stepBallWorld(ball, c.skill);
    stepPlayer(player, candidate);
    const overlap = ballPlayerOverlap(ball, player);
    if (overlap && !collisionFlag) {
      const wasPowerState = player.state === 2;
      collideBallWithPlayer(ball, player, candidate);
      collisionFlag = true;
      if (wasPowerState || ball.isPowerHit) {
        return {
          action: cloneAction(candidate),
          contactFrame: t,
          contactX: ball.x,
          contactY: ball.y,
          ballAfter: cloneBall(ball),
          playerAfter: player,
        };
      }
      return null;
    }
    if (!overlap) collisionFlag = false;
    if (ground) return null;
  }
  return null;
}

function choosePowerAttack(c, estimatedSelfVy) {
  if (c.self.state !== 1 && c.self.state !== 2) return null;

  const dx = abs(c.ball.x - c.self.x);
  const dy = abs(c.ball.y - c.self.y);
  if (
    dx > CFG.POWER_ARM_DISTANCE_X + 36 ||
    dy > CFG.POWER_ARM_DISTANCE_Y + 48
  ) {
    return null;
  }

  let best = null;
  const xChoices = [-1, 0, 1];
  const yChoices = [-1, 0, 1];
  for (let xi = 0; xi < xChoices.length; xi++) {
    for (let yi = 0; yi < yChoices.length; yi++) {
      const x = xChoices[xi];
      const y = yChoices[yi];

      // Candidate hit=1 arms state 1 -> state 2.  If already state 2 the hit
      // bit itself is unnecessary, but keeping it here lets the simulator
      // model a possible state-2 -> state-1 transition before contact.
      const candidate = { x, y, hit: 1 };

      if (
        y === 1 &&
        C.NET_X - c.ball.x > CFG.DOWN_SMASH_MAX_NET_DISTANCE
      ) {
        continue;
      }

      const sim = simulatePowerCandidate(c, candidate, estimatedSelfVy);
      if (!sim) continue;
      const score = evaluateShot(sim.ballAfter, c.opp, c);
      if (!best || score > best.score) {
        best = Object.assign({ score }, sim);
      }
    }
  }

  if (!best) return null;
  return {
    type: 'POWER',
    x: best.action.x,
    y: best.action.y,
    hit: 1,
    score: best.score,
    contactFrame: best.contactFrame,
  };
}

// ============================================================================
// [H] OPPONENT PRE-CONTACT ANTICIPATION
// ============================================================================
function hypotheticalOpponentPowerLanding(c, speedFast, yDir) {
  const ball = cloneBall(c.ball);
  // Opponent is always on canonical RIGHT.  Their power hit sends the ball
  // toward -x.  x-input sign is irrelevant; only zero/nonzero controls speed.
  ball.vx = -(speedFast ? 20 : 10);
  ball.vy = abs(ball.vy) * yDir * 2;
  ball.isPowerHit = true;
  const info = landingInfo(ball, c.skill);
  if (!info || info.x >= C.NET_X) return null;
  return info;
}

function defensiveStandbyX(c) {
  // 공이 상대 코트에 있는 동안에는 상대가 이미 점프해 공 가까이에 올 때까지
  // 기다리지 않고, 미래의 가능한 접촉점 네 개를 먼저 훑는다. 각 접촉점의
  // 파워히트 6종을 합친 뒤 최악의 낙하점 이동 부담이 가장 작은 위치를 고른다.
  const free = simulateFreeTrajectory(c.ball, CFG.BALL_HORIZON, c.skill).frames;
  const contacts = [];
  let lastT = -99;
  for (let i = 0; i < free.length && contacts.length < 4; i++) {
    const bf = free[i];
    if (!bf || bf.x <= C.NET_X || bf.y < 76 || bf.y > 210) continue;
    const t = bf.t || i + 1;
    if (abs(bf.x - c.opp.x) > C.WALK_SPEED * t + C.PLAYER_HALF) continue;
    if (t - lastT < 3) continue;
    contacts.push({ ball: bf, t });
    lastT = t;
  }

  if (contacts.length) {
    const firstT = contacts[0].t;
    const threats = [];
    for (const contact of contacts) {
      const extra = contact.t - firstT;
      for (const speed of [10, 20]) {
        for (const yDir of [-1, 0, 1]) {
          const b = {
            x: contact.ball.x,
            y: contact.ball.y,
            vx: -speed,
            vy: Math.max(abs(contact.ball.vy), 15) * yDir * 2,
            isPowerHit: true,
          };
          const landing = landingInfo(b, c.skill);
          if (landing && landing.x < C.NET_X - 6) {
            threats.push({ x: landing.x, frames: landing.frames + extra });
          }
        }
      }
    }
    if (threats.length) {
      const available = Math.max(0, firstT - CFG.EXPECTED_ACTION_LATENCY_FRAMES);
      let bestX = CFG.STANDBY_X;
      let bestWorst = 1e9;
      for (let x = C.PLAYER_MIN_X; x <= C.PLAYER_MAX_X; x += 4) {
        if (abs(x - c.self.x) > C.WALK_SPEED * available + CFG.MOVE_DEADBAND) continue;
        let worst = -1e9;
        for (const th of threats) {
          const need = abs(th.x - x) - C.WALK_SPEED * th.frames - C.PLAYER_HALF;
          if (need > worst) worst = need;
        }
        if (worst < bestWorst) {
          bestWorst = worst;
          bestX = x;
        }
      }
      const trust = DEF_ADAPTIVE === 1 && activeDefenseMode === 1
        ? 1
        : EARLY_DEF_TRUST;
      return CFG.STANDBY_X + trust * (bestX - CFG.STANDBY_X);
    }
  }

  const nearOpponentContact =
    (c.opp.state === 1 || c.opp.state === 2) &&
    abs(c.ball.x - c.opp.x) <= CFG.THREAT_CONTACT_DISTANCE &&
    abs(c.ball.y - c.opp.y) <= CFG.THREAT_CONTACT_DISTANCE;
  if (!nearOpponentContact) return CFG.STANDBY_X;

  const threats = [];
  for (const fast of [false, true]) {
    for (const y of [-1, 0, 1]) {
      const info = hypotheticalOpponentPowerLanding(c, fast, y);
      if (info) threats.push(info);
    }
  }
  if (!threats.length) return CFG.STANDBY_X;

  let bestX = CFG.STANDBY_X;
  let bestWorst = 1e9;
  for (let x = C.PLAYER_MIN_X; x <= C.PLAYER_MAX_X; x += 4) {
    let worst = -1e9;
    for (const th of threats) {
      const available = Math.max(1, th.frames - CFG.EXPECTED_ACTION_LATENCY_FRAMES);
      const normalizedNeed = abs(th.x - x) / available;
      if (normalizedNeed > worst) worst = normalizedNeed;
    }
    if (worst < bestWorst) {
      bestWorst = worst;
      bestX = x;
    }
  }
  return bestX;
}

// ============================================================================
// [I] TACTICAL PLANNER
// ============================================================================
function moveToward(currentX, targetX) {
  const dx = targetX - currentX;
  if (abs(dx) <= CFG.MOVE_DEADBAND) return 0;
  return dx > 0 ? 1 : -1;
}

function planCore(c, estimatedSelfVy) {
  const tr = simulateFreeTrajectory(c.ball, CFG.BALL_HORIZON, c.skill);
  const frames = tr.frames;
  const landingFrame = frames.length ? frames[frames.length - 1] : null;
  const landing = landingFrame
    ? {
        x: landingFrame.x,
        frames: landingFrame.t,
        wallBounces: tr.wallBounces,
        trajectory: frames,
      }
    : null;

  // 1) If already airborne and a power contact is plausible, attack planning
  //    gets first refusal.  This is the highest leverage action in the game.
  const power = choosePowerAttack(c, estimatedSelfVy);
  if (power) return power;

  // 2) States 3/4 are committed.  Inputs are ignored by the engine; neutral is
  //    safest and avoids stale held inputs when the state unlocks.
  if (c.self.state === 3 || c.self.state === 4 || c.self.state >= 5) {
    return { type: 'COMMITTED', x: 0, y: 0, hit: 0 };
  }

  if (!landing) return { type: 'IDLE', x: 0, y: 0, hit: 0 };

  const landingOwn = landing.x < C.NET_X;

  if (landingOwn) {
    // 3) Find safe ground receive and aggressive jump-contact candidates.
    const groundContact = findGroundContact(c, frames);
    const jumpContact = findJumpNowContact(c, frames);

    // Jump now when it creates a materially better offensive contact, or when
    // there is no clean ground receive.  Because the exact power-hit planner
    // takes over once airborne, this only decides the takeoff timing.
    const likelyOwnServe =
      c.ball.x < 105 && abs(c.ball.vx) <= 1 && c.ball.y < 165;
    const jumpSituationIsTimely =
      likelyOwnServe ||
      (c.ball.x < C.NET_X + 10 && jumpContact && jumpContact.t <= 14);
    if (
      c.self.state === 0 &&
      jumpContact &&
      jumpSituationIsTimely &&
      (!groundContact || jumpContact.score > groundContact.score + 8)
    ) {
      return {
        type: 'JUMP_INTERCEPT',
        x: moveToward(c.self.x, jumpContact.x),
        y: -1,
        hit: 0,
        targetX: jumpContact.x,
      };
    }

    // 4) Emergency dive only if walking cannot plausibly reach the landing.
    if (!canNormalReachLanding(c, landing)) {
      const dive = chooseEmergencyDive(c, landing);
      if (dive) return dive;
    }

    // 5) Normal body receive.  Intentionally stand behind the ball so that a
    //    non-power collision sends it netward and avoids the vx==0 RNG branch.
    let targetX;
    if (groundContact) targetX = groundContact.x;
    else {
      const offset =
        landing.x > C.NET_X - 65
          ? CFG.BODY_RECEIVE_OFFSET_NEAR_NET
          : CFG.BODY_RECEIVE_OFFSET;
      targetX = clamp(landing.x - offset, C.PLAYER_MIN_X, C.PLAYER_MAX_X);
    }

    return {
      type:
        groundContact && groundContact.geometry && groundContact.geometry.type === 'SELF_SET'
          ? 'SELF_SET'
          : 'RECEIVE',
      x: moveToward(c.self.x, targetX),
      y: 0,
      hit: 0,
      targetX,
    };
  }

  // 6) Ball is currently projected to the opponent half.  Do not chase its
  //    current landing point.  Pre-position against the opponent's imminent
  //    shot envelope; otherwise use a central home position.
  const standby = defensiveStandbyX(c);
  return {
    type: 'DEFEND',
    x: moveToward(c.self.x, standby),
    y: 0,
    hit: 0,
    targetX: standby,
  };
}

// ============================================================================
// [J] ACTION EXECUTOR / SAFETY GATE -- KEEP THIS SMALL AND WELL TESTED
// ============================================================================
function executeSafely(c, planned, estimatedSelfVy) {
  let a = { x: planned.x | 0, y: planned.y | 0, hit: planned.hit | 0 };

  // The skill adapter gets a chance to override only after the ordinary plan
  // exists, so a skill failure cannot destroy the basic controller.
  const skillOverride = SKILL.emergencyOverride(c, planned);
  if (skillOverride) a = cloneAction(skillOverride);

  if (c.self.state === 3 || c.self.state === 4 || c.self.state >= 5) {
    return { x: 0, y: 0, hit: 0 };
  }

  if (c.self.state === 0) {
    // Ground + x != 0 + hit == 1 is a dive.  Only the explicit DIVE intent may
    // issue that combination.  This single gate prevents an entire class of
    // stale-input bugs.
    if (planned.type !== 'DIVE') a.hit = 0;
    if (planned.type !== 'JUMP_INTERCEPT' && a.y === -1) a.y = 0;
  }

  if (c.self.state === 1 || c.self.state === 2) {
    const p = clonePlayer(c.self, estimatedSelfVy);
    const landingIn = predictedLandingWithinFrames(p);

    if (planned.type !== 'POWER') {
      a.hit = 0;
      // Do not leave an up-input armed across landing; it can cause an
      // unintended immediate re-jump while the action is held.
      if (a.y === -1) a.y = 0;
    } else {
      // If landing is imminent, a held hit+x can become an accidental dive in
      // the very frame state returns to 0.  Prefer losing a marginal low hit
      // over losing control for a dive/recovery cycle.
      if (landingIn <= CFG.LANDING_SAFETY_FRAMES) {
        a.hit = 0;
        if (a.y === -1) a.y = 0;
      }

      // Once state 2 is armed, hit is not required for the collision itself.
      // Clearing it reduces accidental re-arming after state 2 returns to 1.
      if (c.self.state === 2) a.hit = 0;
    }
  }

  // Contract clamp (defensive; planner should already satisfy it).
  a.x = a.x < 0 ? -1 : a.x > 0 ? 1 : 0;
  a.y = a.y < 0 ? -1 : a.y > 0 ? 1 : 0;
  a.hit = a.hit ? 1 : 0;
  return a;
}

function maybeLog(c, planned, action) {
  if (!CFG.DEBUG) return;
  if (MEM.decisions % CFG.DEBUG_EVERY_DECISIONS !== 0) return;
  console.log(
    '[PikaPlanner]',
    'tick',
    c.tick,
    'mode',
    planned.type,
    'self',
    c.self.x,
    c.self.y,
    'ball',
    c.ball.x,
    c.ball.y,
    c.ball.vx,
    c.ball.vy,
    'action',
    action.x,
    action.y,
    action.hit
  );
}

// ============================================================================
// REQUIRED ENTRY POINT
// ============================================================================
function decide(snapshot) {
  const c = canonicalize(snapshot);
  MEM.decisions++;
  if (defensePrevSelf >= 0 &&
      (c.scoreSelf !== defensePrevSelf || c.scoreOpp !== defensePrevOpp)) {
    defenseTrials[activeDefenseMode]++;
    if (c.scoreSelf > defensePrevSelf) defenseWins[activeDefenseMode]++;
    activeDefenseMode = DEF_ADAPTIVE === 1 ? selectDefenseMode() : 0;
  }
  defensePrevSelf = c.scoreSelf;
  defensePrevOpp = c.scoreOpp;
  updateTouchEstimates(c);

  const prevSelf = MEM.prev ? MEM.prev.self : null;
  const estimatedSelfVy = estimatePlayerVy(c.self, prevSelf);

  let planned;
  try {
    planned = planCore(c, estimatedSelfVy);

    // Skill implementations may add candidate actions without modifying the
    // core planner.  At present there are none.  The convention is that each
    // candidate has {x,y,hit,score,type}; the highest positive score wins.
    const extras = SKILL.extraActions(c) || [];
    if (extras.length) {
      let bestExtra = null;
      for (const e of extras) {
        const v = (typeof e.score === 'number' ? e.score : 0) + SKILL.evaluate(c, e);
        if (!bestExtra || v > bestExtra.value) bestExtra = { value: v, action: e };
      }
      if (bestExtra && bestExtra.value > 0) planned = bestExtra.action;
    }
  } catch (err) {
    // Never sacrifice a tick because an advanced planner path failed.
    if (CFG.DEBUG) console.warn('[PikaPlanner] planner fallback:', String(err));
    const fallbackTarget = c.ball.landingX < C.NET_X
      ? clamp(c.ball.landingX - CFG.BODY_RECEIVE_OFFSET, C.PLAYER_MIN_X, C.PLAYER_MAX_X)
      : CFG.STANDBY_X;
    planned = {
      type: 'FALLBACK',
      x: moveToward(c.self.x, fallbackTarget),
      y: 0,
      hit: 0,
    };
  }

  const canonAction = executeSafely(c, planned, estimatedSelfVy);
  maybeLog(c, planned, canonAction);

  MEM.lastCanonAction = cloneAction(canonAction);
  MEM.prev = c;
  return uncanonicalizeAction(canonAction, c.flip);
}
