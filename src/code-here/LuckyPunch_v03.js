'use strict';

// LuckyPunch v3 — 공격형 (요격 회피 평가)
//
// v1(위치잡기 수비)에 파워히트 공격을 얹었다. 접근 방식은 "엔진 물리를 그대로
// 재현해서 미래를 계산한다"이다. 세 단계로 돌아간다:
//
//   1. 공의 미래 궤적을 프레임 단위로 예측한다 (physics.js와 동일한 규칙).
//   2. "몇 프레임 뒤에 점프하면 공을 공중에서 만날 수 있는가"를 역산해서
//      점프 타이밍을 잡는다.
//   3. 접촉 직전, 파워히트 6조합(|x|∈{0,1} × y∈{-1,0,1}) + 몸통 리턴까지
//      전부 낙하지점을 시뮬레이션해서 상대가 못 따라올 곳으로 보낸다.
//
// 내장 AI의 expectedLandingPointXWhenPowerHit는 네트 충돌 판정을 일부러
// 틀리게 짜 놓았다(원본 주석에 "make computer do mistakes"라고 적혀 있다).
// 여기서는 실제 물리와 같은 판정을 쓰므로 그만큼 예측이 정확하다.

// ── 엔진 상수 (physics.js와 동일해야 한다) ──────────────────
var GROUND_WIDTH = 432;
var NET_X = 216; // GROUND_HALF_WIDTH
var PLAYER_GROUND_Y = 244;
var BALL_GROUND_Y = 252;
var PLAYER_HALF = 32; // 히트박스 반폭·반높이 (충돌 판정 |dx|<=32 && |dy|<=32)
var NET_HALF_W = 25;
var NET_TOP_TOP = 176;
var NET_TOP_BOTTOM = 192;
var PLAYER_SPEED = 6; // xDirection * 6
var SIM_LIMIT = 200;
var TRAJ_FRAMES = 150;

// ── 튜닝 파라미터 ────────────────────────────────────────────
var WALK_DEADBAND = 7; // 1 tick 지연에 의한 좌우 진동 억제
var RECEIVE_OFFSET = 12; // 몸통 리턴 시 낙하지점에서 물러설 픽셀
var CONTACT_Y_TOL = 26; // 점프 계획에서 허용할 높이 오차
var HIT_LEAD_FRAMES = 7; // 접촉 이 프레임 전부터 hit=1 (state 2가 ~10프레임 지속)
var MIN_SMASH_HEIGHT = 210; // 이보다 공이 낮으면 점프 스매시 대신 몸으로 받는다
var BODY_RETURN_BIAS = 12; // 동점이면 파워히트를 선호
var MARGIN_WEIGHT = 1; // 요격 회피 항의 비중 (0이면 낙하지점만 보는 v2와 동일)
var LAG_FRAMES = 2; // 내 결정이 실제 조작에 반영되기까지의 프레임 수 (1~3 전 구간에서 가장 강건한 값 — 하네스 실측)

// ── 점프 궤적 테이블 ────────────────────────────────────────
// 엔진: 점프 입력 프레임에 yVelocity=-16, 매 프레임 y+=v 후 v+=1.
// JUMP_Y[n] = 점프 입력으로부터 n프레임 뒤의 플레이어 y. 정점은 n=16, y=108.
var JUMP_Y = (function () {
  var arr = [PLAYER_GROUND_Y];
  var y = PLAYER_GROUND_Y;
  var v = -16;
  for (var i = 0; i < 40; i++) {
    y = y + v;
    if (y > PLAYER_GROUND_Y) {
      arr.push(PLAYER_GROUND_Y);
      break;
    }
    arr.push(y);
    v += 1;
  }
  return arr;
})();
var JUMP_LAST = JUMP_Y.length - 1;
var JUMP_APEX_Y = Math.min.apply(Math, JUMP_Y); // 점프 정점 y (=108)

// ── tick 사이에 유지되는 상태 ────────────────────────────────
// (LEFT/RIGHT는 각자 다른 Worker라 서로 공유되지 않는다)
var prevSelfY = PLAYER_GROUND_Y;
var prevBallX = -1; // 직전 tick의 공 위치 — physics 정지 구간 감지용
var prevBallY = -1;
var tickCounter = 0;

/**
 * 공의 월드 충돌 1프레임 — physics.js의
 * processCollisionBetweenBallAndWorldAndSetBallPosition과 같은 순서.
 * 땅에 닿으면 true.
 */
function stepBall(b) {
  var futureX = b.x + b.vx;
  if (futureX < 0 || futureX > GROUND_WIDTH) {
    b.vx = -b.vx;
  }
  if (b.y + b.vy < 0) {
    b.vy = 1;
  }
  // 네트 기둥
  if (Math.abs(b.x - NET_X) < NET_HALF_W && b.y > NET_TOP_TOP) {
    if (b.y <= NET_TOP_BOTTOM) {
      if (b.vy > 0) {
        b.vy = -b.vy;
      }
    } else {
      b.vx = b.x < NET_X ? -Math.abs(b.vx) : Math.abs(b.vx);
    }
  }
  var futureY = b.y + b.vy;
  if (futureY > BALL_GROUND_Y) {
    b.y = BALL_GROUND_Y;
    return true; // 이 프레임엔 x를 더하지 않는다 (엔진과 동일)
  }
  b.y = futureY;
  b.x = b.x + b.vx;
  b.vy += 1;
  return false;
}

/** 현재 공 상태에서 프레임별 미래 위치. traj[0]이 현재. */
function predictTrajectory(ball) {
  var b = { x: ball.x, y: ball.y, vx: ball.xVelocity, vy: ball.yVelocity };
  var traj = [{ x: b.x, y: b.y, vy: b.vy }];
  for (var i = 1; i <= TRAJ_FRAMES; i++) {
    var landed = stepBall(b);
    traj.push({ x: b.x, y: b.y, vy: b.vy });
    if (landed) {
      break;
    }
  }
  return traj;
}

/**
 * 공을 날렸을 때 상대가 얼마나 곤란한지를 평가한다.
 *
 * v2는 "낙하지점이 상대에게서 얼마나 먼가"만 봤는데, 그건 부족하다.
 * 평평한 스매시(y=0)는 낙하지점은 멀어도 상대 코트를 타격 높이로 천천히
 * 가로질러서 상대에게 공짜 반격 기회를 준다. 실제로 이것 때문에 자기대전에서
 * 서브를 넣은 쪽이 오히려 지는 일이 잦았다.
 *
 * 그래서 낙하 순간만이 아니라 **비행 전 구간**에서 상대가 손댈 수 있는지를 본다.
 * 각 프레임마다 "상대가 그 지점까지 가려면 몇 픽셀 모자라는가"를 재고,
 * 그 중 가장 작은 값(=상대에게 가장 쉬운 순간)이 이 공격의 품질이다.
 * 값이 양수면 상대는 어느 시점에도 공에 닿을 수 없다.
 *
 * @return {{landingX:number, frames:number, margin:number}}
 */
function evaluateShot(x, y, vx, vy, oppOnRight, oppX) {
  var b = { x: x, y: y, vx: vx, vy: vy };
  var oppReachMin = oppOnRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var oppReachMax = oppOnRight ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  var easiest = 1e9;
  var frames = SIM_LIMIT;
  for (var t = 1; t <= SIM_LIMIT; t++) {
    var landed = stepBall(b);
    // 상대 코트 안이고, 상대가 점프해서 닿을 수 있는 높이인가
    // (점프 정점 y=108, 히트박스 ±32 → y가 76보다 작으면 못 닿는다)
    var inOppCourt = oppOnRight ? b.x > NET_X : b.x < NET_X;
    if (inOppCourt && b.y >= JUMP_APEX_Y - PLAYER_HALF) {
      var canLo = Math.max(oppReachMin, oppX - PLAYER_SPEED * t);
      var canHi = Math.min(oppReachMax, oppX + PLAYER_SPEED * t);
      var shortfall = b.x < canLo ? canLo - b.x : b.x > canHi ? b.x - canHi : 0;
      var margin = shortfall - PLAYER_HALF; // 양수 = 못 닿음
      if (margin < easiest) {
        easiest = margin;
      }
    }
    if (landed) {
      frames = t;
      break;
    }
  }
  return {
    landingX: b.x,
    frames: frames,
    margin: easiest === 1e9 ? -999 : easiest,
  };
}

/**
 * 파워히트 직후의 공 속도.
 * 방향은 내 입력 x의 부호가 아니라 "공이 네트 어느 쪽에 있는가"로 결정된다.
 * |x|는 속도 배율(0이면 10, 1이면 20)일 뿐이다.
 */
function powerHitVelocity(ballX, ballVy, xMag, yDir) {
  return {
    vx: ballX < NET_X ? (xMag + 1) * 10 : -(xMag + 1) * 10,
    vy: Math.max(Math.abs(ballVy), 15) * yDir * 2,
  };
}

/** 파워히트 없이 몸에 맞고 튕길 때의 공 속도. */
function bodyReturnVelocity(ballX, ballVy, playerX) {
  var vx = 0;
  if (ballX < playerX) {
    vx = -((Math.abs(ballX - playerX) / 3) | 0);
  } else if (ballX > playerX) {
    vx = (Math.abs(ballX - playerX) / 3) | 0;
  }
  // vx가 0이면 엔진이 -1/0/1 중 랜덤으로 정한다. 예측 불가라 0으로 둔다.
  var abs = Math.abs(ballVy);
  return { vx: vx, vy: abs < 15 ? -15 : -abs };
}

/**
 * evaluateShot 결과를 하나의 점수로.
 *
 * 두 가지를 섞는다:
 *  - 낙하 항: 낙하지점이 상대에게서 얼마나 먼가 (상대 이동거리 6px/frame 차감)
 *  - 요격 항: 비행 전 구간에서 상대가 손댈 수 있는 최소 여유
 * 요격 항만 쓰면 지나치게 비관적이라(상대가 타이밍까지 완벽히 맞춘다고 가정)
 * 느린 아치만 고르게 된다. MARGIN_WEIGHT로 둘의 비중을 조절한다.
 */
function scoreShot(shot, oppOnRight, oppX) {
  var intoOppCourt = oppOnRight
    ? shot.landingX > NET_X + 6
    : shot.landingX < NET_X - 6;
  if (!intoOppCourt) {
    // 내 코트에 꽂히거나 네트에 걸린다. 자책골이므로 크게 감점.
    return -1000 + (oppOnRight ? shot.landingX : -shot.landingX);
  }
  var landingTerm =
    Math.abs(shot.landingX - oppX) - PLAYER_SPEED * shot.frames;
  return landingTerm + MARGIN_WEIGHT * shot.margin;
}

/**
 * 접촉 시점의 공 상태로 파워히트 6조합 + 몸통 리턴을 전부 시뮬레이션해서
 * 가장 좋은 것을 고른다.
 */
function chooseHit(ballX, ballY, ballVy, playerX, oppOnRight, oppX) {
  var best = null;
  for (var xMag = 1; xMag >= 0; xMag--) {
    for (var yDir = 1; yDir >= -1; yDir--) {
      var v = powerHitVelocity(ballX, ballVy, xMag, yDir);
      var shot = evaluateShot(ballX, ballY, v.vx, v.vy, oppOnRight, oppX);
      var score = scoreShot(shot, oppOnRight, oppX);
      if (best === null || score > best.score) {
        best = {
          score: score,
          hit: 1,
          xMag: xMag,
          yDir: yDir,
          landing: shot.landingX,
        };
      }
    }
  }
  // 어떤 파워히트도 내 코트에 꽂히는 상황이면 몸으로 받는 게 낫다.
  var bv = bodyReturnVelocity(ballX, ballVy, playerX);
  var bodyShot = evaluateShot(ballX, ballY, bv.vx, bv.vy, oppOnRight, oppX);
  var bodyScore = scoreShot(bodyShot, oppOnRight, oppX) - BODY_RETURN_BIAS;
  if (bodyScore > best.score) {
    best = {
      score: bodyScore,
      hit: 0,
      xMag: 0,
      yDir: 0,
      landing: bodyShot.landingX,
    };
  }
  return best;
}

/**
 * 지금 내 y가 점프 궤적의 몇 번째 프레임인지 역산.
 * 올라가는 중과 내려오는 중은 같은 y를 가지므로 직전 tick의 y로 방향을 가른다.
 */
function jumpPhase(y, prevY) {
  var n;
  if (y > prevY) {
    for (n = JUMP_LAST; n >= 0; n--) {
      if (JUMP_Y[n] === y) {
        return n;
      }
    }
  } else {
    for (n = 0; n <= JUMP_LAST; n++) {
      if (JUMP_Y[n] === y) {
        return n;
      }
    }
  }
  return -1;
}

function jumpYAt(n) {
  return JUMP_Y[n < 0 ? 0 : n > JUMP_LAST ? JUMP_LAST : n];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 목표 x로 걸어가는 방향. 데드밴드 안이면 멈춘다. */
function walkTo(targetX, myX) {
  var dx = targetX - myX;
  if (Math.abs(dx) <= WALK_DEADBAND) {
    return 0;
  }
  return dx > 0 ? 1 : -1;
}

/** 공중에서 공 x를 따라붙는 방향 (데드밴드를 좁게 잡는다). */
function trackX(ballX, myX) {
  var dx = ballX - myX;
  if (Math.abs(dx) <= 4) {
    return 0;
  }
  return dx > 0 ? 1 : -1;
}

/** think()가 예외로 죽었을 때의 최소 동작 — 예상 낙하지점만 따라간다. */
function fallback(s) {
  var dx = s.ball.expectedLandingPointX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 8) {
    x = dx > 0 ? 1 : -1;
  }
  return { x: x, y: 0, hit: 0 };
}

function think(s, prevY) {
  var isLeft = s.side !== 'RIGHT';
  var lag = LAG_FRAMES;

  var myX = s.self.x;
  var myY = s.self.y;
  var myState = s.self.state;
  var oppX = s.opp.x;

  var courtMin = isLeft ? 0 : NET_X;
  var courtMax = isLeft ? NET_X : GROUND_WIDTH;
  var standbyX = (courtMin + courtMax) / 2;
  // 플레이어가 실제로 설 수 있는 x 범위 (엔진이 이 밖으로는 못 나가게 막는다)
  var reachMin = courtMin + PLAYER_HALF;
  var reachMax = courtMax - PLAYER_HALF;

  var traj = predictTrajectory(s.ball);
  var landIdx = traj.length - 1;
  var landX = traj[landIdx].x;
  var landsOnMySide = landX > courtMin && landX < courtMax;

  // ── 공중에 있다면: 공을 따라가며 접촉 시점을 잡아 스매시 ──────
  if (myState === 1 || myState === 2) {
    var n = jumpPhase(myY, prevY);
    var contact = -1;
    if (n >= 0) {
      for (var f = lag; f < traj.length && f - lag <= 24; f++) {
        var p = traj[f];
        if (Math.abs(p.y - jumpYAt(n + f)) > PLAYER_HALF) {
          continue;
        }
        // 그 프레임까지 좌우로 따라붙을 수 있는지
        var canBe = clamp(p.x, myX - PLAYER_SPEED * f, myX + PLAYER_SPEED * f);
        canBe = clamp(canBe, reachMin, reachMax);
        if (Math.abs(p.x - canBe) > PLAYER_HALF) {
          continue;
        }
        contact = f;
        break;
      }
    }

    var xToBall = trackX(traj[Math.min(lag, landIdx)].x, myX);

    if (contact >= 0 && contact <= lag + HIT_LEAD_FRAMES) {
      var c = traj[contact];
      // 네트 너머(상대 코트)에서 치면 공이 내 코트로 돌아온다. 그건 피한다.
      var onMySideAtContact = isLeft ? c.x < NET_X : c.x > NET_X;
      if (onMySideAtContact) {
        var best = chooseHit(c.x, c.y, c.vy, myX, isLeft, oppX);
        if (best.hit === 1) {
          // |x|=1이면 공 속도가 2배. 부호는 공 쪽으로 두어 정렬이 흐트러지지 않게.
          var hx = best.xMag === 0 ? 0 : xToBall !== 0 ? xToBall : 1;
          return { x: hx, y: best.yDir, hit: 1 };
        }
        return { x: xToBall, y: 0, hit: 0 };
      }
    }
    return { x: xToBall, y: 0, hit: 0 };
  }

  // ── 땅에 있고 공이 상대 쪽으로 갈 때: 중앙 대기 ──────────────
  if (!landsOnMySide) {
    return { x: walkTo(standbyX, myX), y: 0, hit: 0 };
  }

  // ── 땅에 있고 공이 내 쪽으로 올 때: 점프 스매시 계획 ─────────
  // "프레임 g에 공을 만나려면 g-k 프레임에 점프해야 한다"를 역산한다.
  // g를 작은 것부터 보므로, 닿을 수 있는 가장 이른(=가장 높은) 접촉을 고른다.
  var plan = null;
  for (var g = lag; g < traj.length; g++) {
    var q = traj[g];
    if (isLeft ? q.x >= NET_X : q.x <= NET_X) {
      continue; // 아직 네트 너머
    }
    if (q.y > MIN_SMASH_HEIGHT) {
      continue; // 너무 낮다 — 점프해봤자 착지 중에 지나간다
    }
    var target = clamp(q.x, reachMin, reachMax);
    if (Math.abs(target - myX) > PLAYER_SPEED * (g - lag) + PLAYER_HALF) {
      continue; // 그 프레임까지 못 간다
    }
    for (var k = 1; k <= JUMP_LAST; k++) {
      if (Math.abs(JUMP_Y[k] - q.y) > CONTACT_Y_TOL) {
        continue;
      }
      var jumpAt = g - k;
      if (jumpAt < lag) {
        continue; // 이미 늦었다 — 더 늦은 접촉을 찾는다
      }
      plan = { contact: g, jumpAt: jumpAt, x: q.x };
      break;
    }
    if (plan !== null) {
      break;
    }
  }

  if (plan !== null) {
    var walk = walkTo(clamp(plan.x, reachMin, reachMax), myX);
    // 이 tick의 입력은 lag 프레임 뒤부터 3프레임 동안 유지된다.
    // jumpAt이 그 창 안에 들어오면 지금 점프한다.
    if (plan.jumpAt <= lag + 2) {
      return { x: walk, y: -1, hit: 0 };
    }
    return { x: walk, y: 0, hit: 0 };
  }

  // ── 점프 스매시가 안 되는 경우: 몸으로 받기 (v1 로직) ────────
  var towardNet = isLeft ? 1 : -1;
  var recvX = clamp(landX - towardNet * RECEIVE_OFFSET, reachMin, reachMax);
  var framesLeft = landIdx - lag;
  var gap = Math.abs(recvX - myX);

  // 걸어서는 못 닿는데 다이빙이면 닿을 만한 거리면 다이빙 (지상 + x≠0 + hit=1)
  if (
    framesLeft > 0 &&
    gap > PLAYER_SPEED * framesLeft &&
    gap < PLAYER_SPEED * framesLeft + 48 &&
    s.ball.y > NET_TOP_TOP
  ) {
    return { x: recvX > myX ? 1 : -1, y: 0, hit: 1 };
  }

  return { x: walkTo(recvX, myX), y: 0, hit: 0 };
}

function decide(s) {
  tickCounter++;
  var prevY = prevSelfY;
  prevSelfY = s.self.y;

  // ── 랠리 시작 전 "정지 구간" 처리 (이걸 빼먹으면 서브를 통째로 놓친다) ──
  // 득점 후 게임은 afterEndOfRound(5프레임) → beforeStartOfNextRound(30프레임)
  // 동안 physics를 돌리지 않는다. 그런데 decide는 그 사이에도 계속 호출된다.
  // 그 얼어붙은 스냅샷을 보고 "지금 점프"라고 답해버리면, 그 입력이 랠리
  // 첫 프레임에 그대로 적용되어 공이 오기 30프레임 전에 점프해버린다.
  // (점프는 33프레임이면 끝나므로 공이 도착할 땐 이미 착지해 있다.)
  //
  // 공이 직전 tick과 완전히 같은 자리에 있으면 physics가 멈춘 것이다.
  // 이때는 좌우 이동만 남기고 점프·파워히트는 죽인다. 이동 입력은 어차피
  // 정지 중엔 반영되지 않지만, 랠리가 시작되는 첫 프레임부터 걸어갈 수 있어
  // 오히려 이득이다.
  var frozen =
    (s.ball.x === prevBallX && s.ball.y === prevBallY) || s.ball.y === 0;
  prevBallX = s.ball.x;
  prevBallY = s.ball.y;

  var action;
  try {
    action = think(s, prevY);
  } catch (e) {
    // 예외가 나도 그 tick만 무입력이 되고 매치는 계속되지만,
    // 최소한 낙하지점 추적은 유지해서 가만히 서 있지 않도록 한다.
    action = fallback(s);
  }
  if (frozen) {
    return { x: action.x, y: 0, hit: 0 };
  }
  return action;
}
