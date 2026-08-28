'use strict';

// LuckyPunch v6 — 커밋 겨냥 공격 (v5 기반)
//
// v5의 공격은 수비수를 "전지적"으로 가정한다: 내 결정 순간부터 상대가
// 최종 낙하점을 향해 최적 이동을 시작한다고 보고(reach = 6*(t+headStart)),
// 그 최악 가정에서도 못 닿는 공만 킬로 친다. 그래서 대부분의 옵션이
// "닿을 수 있음"으로 기각되고, 실제로는 킬인 공을 놓친다.
//
// 실제 수비수는 그렇게 못 움직인다:
//   1. 어딘가로 이미 걸어가는 중이다 (커밋). v5의 예측 수비조차 maximin
//      위치로 미리 걸어가는 커밋이다.
//   2. 내 타격을 보고 나서야 방향을 바꾸고, 그 반응에도 ~1 tick이 걸린다.
//
// v6의 공격 채점: 상대 속도를 추적해 내 타격 시점의 위치 p-hat을 외삽하고,
// 타격 후 반응 지연 OPP_REACT 프레임을 준 뒤에야 p-hat에서 움직이기
// 시작한다고 본다 (reach = 6*max(0, t-OPP_REACT) + 32). 즉 "상대가 실제로
// 있을 곳의 반대편"을 노린다.
//
// 솔직한 성적표: 이 모델로 v5를 "이기는" 것은 실패했다. v5와의 맞대결은
// 랠리 패턴상 서브 넣은 쪽이 이기는 동전던지기가 지배해서 50%다. 다만
// 상대 풀(AI·v1~v4) 종합에서는 92.6%로 v5(90.2%)와 동급~미세 우위라
// 제출 후보 자격은 유지한다. 상세 측정은 CLAUDE.md 참고.
//
// 수비는 v5의 예측 수비(maximin 낙하 지점 선점)를 그대로 쓴다.

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
var RECEIVE_OFFSET = 12; // 세팅을 못 할 때 낙하지점에서 물러설 픽셀
var CONTACT_Y_TOL = 26; // 점프 계획에서 허용할 높이 오차
var HIT_LEAD_FRAMES = 7; // 접촉 이 프레임 전부터 hit=1 (state 2가 ~10프레임 지속)
var MIN_SMASH_HEIGHT = 210; // 이보다 공이 낮으면 점프 스매시 대신 몸으로 받는다
var BODY_RETURN_BIAS = 12; // 동점이면 파워히트를 선호
var MARGIN_WEIGHT = 1; // 요격 회피 항의 비중
var LAG_FRAMES = 2; // 내 결정이 실제 조작에 반영되기까지의 프레임 수 (실측 기반)
var SET_MIN_GAIN = 25; // 세팅이 직접 공격보다 이만큼은 나아야 세팅한다
var SET_OFFSET_STEP = 3; // 세팅 위치 후보 간격 (vx는 3픽셀마다 1씩 바뀐다)
var MAX_SET_TOUCHES = 0; // 세팅 사용 안 함 — 측정 결과 순손해였다 (CLAUDE.md 참고)
var CONTACT_CANDIDATES = 6; // 접촉 시점 후보를 몇 개까지 비교할지
var OPP_REACT = 4; // 상대의 반응 지연 (결정 1 tick + 반영 1프레임)
var DEF_GROUND_TRUST = 1; // 상대가 지상일 때 예측 위치를 얼마나 믿을지 (0=중앙, 1=전량)
// 1로 확정: 실측 지연(1프레임) 환경에서 전 상대 최소 75%, v3·v4 상대 100%.
// 지연이 2로 커지면 약한 상대에게 손해를 보는 트레이드오프가 있으나(21~25%),
// 반영 지연 1은 브라우저에서 직접 계측한 값이라 lag1 성능을 우선했다.
var DEF_AIR = 0; // 공중 수비 복귀 — 측정 결과 예측 수비와 조합 시 손해라 OFF (아래 헤더 참고)
var DEF_PREDICT = 1; // 1이면 maximin 예측 수비, 0이면 코트 중앙 대기
var CONTACT_GAIN = 60; // 늦은 접촉이 이만큼 더 좋아야 늦춘다
// 15로 낮추는 실험을 했다가 되돌렸다: 특정 시드에서 v5 상대 성적이 좋아 보였지만
// 상대 풀 전체(AI·v1~v4) 종합에서는 평균 72.5%로 크게 후퇴했다. 60이면 풀 종합
// 92.6%로 v5(90.2%)와 동급이고 v5와의 맞대결은 50%다. 집안 맞대결은 어차피
// "서브 넣은 쪽이 이기는" 동전던지기 패턴이 지배해서 신호가 거의 없다.

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
var prevOppX = -1; // 상대 속도 추정용 (커밋 방향)
var oppVelPerFrame = 0; // 상대의 프레임당 x 속도 추정치
var prevBallX = -1; // physics 정지 구간 감지용
var prevBallY = -1;
var prevBallVy = 0;
var prevOnMySide = null; // 공이 직전 tick에 내 코트에 있었는지
var possessionTouches = 0; // 이번 점유에서 내가 공에 댄 횟수
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

/** 주어진 공 상태에서 프레임별 미래 위치. [0]이 현재. */
function simulateFrom(x, y, vx, vy) {
  var b = { x: x, y: y, vx: vx, vy: vy };
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
 * 낙하 순간만이 아니라 비행 전 구간에서 상대가 손댈 수 있는지를 본다.
 * 각 프레임마다 "상대가 그 지점까지 가려면 몇 픽셀 모자라는가"를 재고,
 * 그 중 가장 작은 값(=상대에게 가장 쉬운 순간)이 이 공격의 품질이다.
 *
 * pHat: 내 타격 시점의 상대 예상 위치 (predictOppX로 외삽).
 *
 * @return {{landingX:number, frames:number, margin:number}}
 */
function evaluateShot(x, y, vx, vy, oppOnRight, pHat) {
  var b = { x: x, y: y, vx: vx, vy: vy };
  var oppReachMin = oppOnRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var oppReachMax = oppOnRight
    ? GROUND_WIDTH - PLAYER_HALF
    : NET_X - PLAYER_HALF;
  var easiest = 1e9;
  var frames = SIM_LIMIT;
  for (var t = 1; t <= SIM_LIMIT; t++) {
    var landed = stepBall(b);
    // 상대 코트 안이고, 상대가 점프해서 닿을 수 있는 높이인가
    // (점프 정점 y=108, 히트박스 ±32 → y가 76보다 작으면 못 닿는다)
    var inOppCourt = oppOnRight ? b.x > NET_X : b.x < NET_X;
    if (inOppCourt && b.y >= JUMP_APEX_Y - PLAYER_HALF) {
      // 커밋+반응 모델: 상대는 타격 시점에 pHat에 있고, OPP_REACT 프레임이
      // 지나야 움직이기 시작한다. (v5의 전지적 모델은 t+headStart를 전부
      // 이동에 쓸 수 있다고 봐서 실제 킬을 대부분 기각했다)
      var reach = PLAYER_SPEED * Math.max(0, t - OPP_REACT);
      var canLo = Math.max(oppReachMin, pHat - reach);
      var canHi = Math.min(oppReachMax, pHat + reach);
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
 * 내 타격이 일어날 시점(frames 프레임 뒤)의 상대 위치 외삽.
 * 관측된 속도로 등속 이동한다고 보되, 상대 코트 밖으로는 못 나간다.
 */
function predictOppX(oppX, frames, oppOnRight) {
  var lo = oppOnRight ? NET_X + PLAYER_HALF : PLAYER_HALF;
  var hi = oppOnRight ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  return clamp(oppX + oppVelPerFrame * frames, lo, hi);
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

/** 파워히트 없이 몸에 맞고 튕길 때의 공 속도. playerX로 vx를 조절할 수 있다. */
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

/** evaluateShot 결과를 하나의 점수로. 상대 코트에 못 꽂으면 큰 감점. */
function scoreShot(shot, oppOnRight, oppX) {
  var intoOppCourt = oppOnRight
    ? shot.landingX > NET_X + 6
    : shot.landingX < NET_X - 6;
  if (!intoOppCourt) {
    return -1000 + (oppOnRight ? shot.landingX : -shot.landingX);
  }
  var landingTerm =
    Math.abs(shot.landingX - oppX) -
    PLAYER_SPEED * Math.max(0, shot.frames - OPP_REACT);
  return landingTerm + MARGIN_WEIGHT * shot.margin;
}

/**
 * 접촉 시점의 공 상태로 파워히트 6조합 + 몸통 리턴을 전부 시뮬레이션해서
 * "상대 코트로 넘기는" 최선의 수를 고른다.
 */
function chooseHit(ballX, ballY, ballVy, playerX, oppOnRight, pHat) {
  var best = null;
  for (var xMag = 1; xMag >= 0; xMag--) {
    for (var yDir = 1; yDir >= -1; yDir--) {
      var v = powerHitVelocity(ballX, ballVy, xMag, yDir);
      var shot = evaluateShot(ballX, ballY, v.vx, v.vy, oppOnRight, pHat);
      var score = scoreShot(shot, oppOnRight, pHat);
      if (best === null || score > best.score) {
        best = { score: score, hit: 1, xMag: xMag, yDir: yDir };
      }
    }
  }
  // 어떤 파워히트도 내 코트에 꽂히는 상황이면 몸으로 받는 게 낫다.
  var bv = bodyReturnVelocity(ballX, ballVy, playerX);
  var bodyShot = evaluateShot(ballX, ballY, bv.vx, bv.vy, oppOnRight, pHat);
  var bodyScore =
    scoreShot(bodyShot, oppOnRight, pHat) - BODY_RETURN_BIAS;
  if (bodyScore > best.score) {
    best = { score: bodyScore, hit: 0, xMag: 0, yDir: 0 };
  }
  return best;
}

/**
 * 주어진 궤적에서 "점프해서 칠 수 있는 가장 이른 접촉"을 찾는다.
 * 이른 접촉일수록 공이 높아 각도가 좋다.
 *
 * @param traj simulateFrom 결과
 * @param startIdx 이 인덱스부터 움직일 수 있다 (지연 반영)
 * @param startX 그 시점의 내 x
 */
function findJumpContacts(traj, startIdx, startX, isLeft, reachMin, reachMax, limit) {
  var out = [];
  for (var g = startIdx; g < traj.length; g++) {
    var q = traj[g];
    if (isLeft ? q.x >= NET_X : q.x <= NET_X) {
      continue; // 네트 너머 — 여기서 치면 공이 내 코트로 돌아온다
    }
    if (q.y > MIN_SMASH_HEIGHT) {
      continue; // 너무 낮다 — 점프해봤자 착지 중에 지나간다
    }
    var target = clamp(q.x, reachMin, reachMax);
    if (Math.abs(target - startX) > PLAYER_SPEED * (g - startIdx) + PLAYER_HALF) {
      continue; // 그 프레임까지 못 간다
    }
    for (var k = 1; k <= JUMP_LAST; k++) {
      if (Math.abs(JUMP_Y[k] - q.y) > CONTACT_Y_TOL) {
        continue;
      }
      if (g - k < startIdx) {
        continue; // 점프하기엔 이미 늦었다
      }
      out.push({ contact: g, jumpAt: g - k, x: q.x, y: q.y, vy: q.vy });
      break;
    }
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/** 후보 중 가장 이른 접촉 하나 (세팅 계획용 — 여기선 품질보다 존재 여부가 중요) */
function findJumpContact(traj, startIdx, startX, isLeft, reachMin, reachMax) {
  var list = findJumpContacts(traj, startIdx, startX, isLeft, reachMin, reachMax, 1);
  return list.length > 0 ? list[0] : null;
}

/**
 * 예측 수비 (maximin).
 *
 * 공이 상대 쪽에 있을 때: 상대가 언제 어디서 공을 칠지 추정하고, 그 접촉
 * 상태에서 가능한 파워히트 6종의 궤적을 전부 시뮬레이션한다. 각 후보
 * 위치 p에 대해 "가장 받기 어려운 위협까지의 부족 거리"를 재고, 그 최악값이
 * 가장 작은 p를 수비 위치로 고른다.
 *
 * 상대가 내 위치에서 가장 먼 곳을 노리는 봇(v4류)이라면 이게 정확한 최적
 * 대응이고, 다른 봇이라도 위협 집합 전체를 커버하는 위치라 손해가 없다.
 *
 * @return {{x:number, worst:number}|null} 수비 위치. 위협이 없으면 null.
 */
function planDefense(traj, lag, myX, isLeft, reachMin, reachMax, oppX) {
  // 1) 상대의 접촉 시점 추정 — 상대 코트에서 상대가 도달 가능하고
  //    스매시 가능한 높이(y <= 210)에 공이 있는 가장 이른 프레임.
  //    (v4류는 가장 이른 접촉을 고르므로 이 추정이 실제와 거의 일치한다)
  var contactIdx = -1;
  for (var g = 0; g < traj.length; g++) {
    var q = traj[g];
    var onOppSide = isLeft ? q.x > NET_X : q.x < NET_X;
    if (!onOppSide) {
      continue;
    }
    if (q.y > MIN_SMASH_HEIGHT) {
      continue;
    }
    if (Math.abs(q.x - oppX) > PLAYER_SPEED * g + PLAYER_HALF) {
      continue; // 상대가 그 프레임까지 못 간다
    }
    contactIdx = g;
    break;
  }
  if (contactIdx < 0) {
    return null;
  }
  var c = traj[contactIdx];

  // 2) 위협 목록 — 그 접촉에서 가능한 파워히트 6종의 "낙하 지점"과 비행 시간.
  //
  //    비행 중 요격까지 커버리지로 치면 과대평가가 된다 (공중 요격은 점프
  //    선행 프레임이 필요해서 실제로는 거의 못 잡는다 — 측정으로 확인).
  //    믿을 수 있는 수비는 "낙하 지점에 공보다 먼저 도착해 몸으로 받기"뿐이고,
  //    그래서 위협을 낙하 지점으로 요약한다.
  var threats = [];
  for (var xMag = 0; xMag <= 1; xMag++) {
    for (var yDir = -1; yDir <= 1; yDir++) {
      var v = powerHitVelocity(c.x, c.vy, xMag, yDir);
      var b = { x: c.x, y: c.y, vx: v.vx, vy: v.vy };
      var flight = -1;
      for (var t = 1; t <= SIM_LIMIT; t++) {
        if (stepBall(b)) {
          flight = t;
          break;
        }
      }
      // 내 코트에 떨어지는 것만 위협이다 (자기 코트행·네트행은 상대의 자책)
      var landsOnMe =
        flight > 0 && (isLeft ? b.x < NET_X - 6 : b.x > NET_X + 6);
      if (landsOnMe) {
        threats.push({ landX: b.x, flight: flight });
      }
    }
  }
  // 7번째 위협: 파워히트 없이 몸으로만 받는 리턴 (수직에 가깝게 떠오른다).
  // 내장 AI나 수비형 봇이 자주 쓰는 수라 커버 대상에 넣는다.
  {
    var bb = { x: c.x, y: c.y, vx: 0, vy: -Math.max(Math.abs(c.vy), 15) };
    var bf = -1;
    for (var tt = 1; tt <= SIM_LIMIT; tt++) {
      if (stepBall(bb)) {
        bf = tt;
        break;
      }
    }
    if (bf > 0 && (isLeft ? bb.x < NET_X - 6 : bb.x > NET_X + 6)) {
      threats.push({ landX: bb.x, flight: bf });
    }
  }
  if (threats.length === 0) {
    return null;
  }

  // 3) 접촉 전까지 실제로 도달 가능한 위치들에 대해 maximin.
  //    margin(위협, p) = |낙하x - p| - 6*비행프레임 - 32
  //    양수 = p에서 출발하면 그 위협의 낙하 지점에 제때 못 간다.
  //    동률(±1px)이면 코트 중앙에 가까운 쪽 — 다음 전개에 중립적이다.
  var avail = Math.max(0, contactIdx - lag);
  var center = (reachMin + reachMax) / 2;
  var best = null;
  for (var p = reachMin; p <= reachMax; p += 8) {
    if (Math.abs(p - myX) > PLAYER_SPEED * avail + WALK_DEADBAND) {
      continue;
    }
    var worst = -1e9;
    for (var i = 0; i < threats.length; i++) {
      var th = threats[i];
      var margin =
        Math.abs(th.landX - p) - PLAYER_SPEED * th.flight - PLAYER_HALF;
      if (margin > worst) {
        worst = margin;
      }
    }
    if (
      best === null ||
      worst < best.worst - 1 ||
      (Math.abs(worst - best.worst) <= 1 &&
        Math.abs(p - center) < Math.abs(best.x - center))
    ) {
      best = { x: p, worst: worst };
    }
  }
  return best;
}

/**
 * 세팅 계획: 몸통으로 받아 내 코트에 띄운 뒤, 그 공을 스매시한다.
 *
 * 서는 위치(offset)를 바꿔가며 2수 앞을 시뮬레이션하고, 이어지는 스매시가
 * 가장 좋은 위치를 고른다. 세팅에 쓴 프레임은 headStart로 상대에게 준
 * 여유로 계산되므로, 시간만 낭비하는 세팅은 자동으로 걸러진다.
 *
 * @return {{standX:number, score:number, frame:number}|null}
 */
function planSet(traj, lag, myX, isLeft, reachMin, reachMax, oppOnRight, oppX) {
  // 서서 몸에 맞힐 수 있는 첫 프레임 (공 y가 내 히트박스에 들어오는 순간)
  var setFrame = -1;
  for (var g = lag; g < traj.length; g++) {
    var q = traj[g];
    if (isLeft ? q.x >= NET_X : q.x <= NET_X) {
      continue;
    }
    if (q.vy > 0 && q.y >= PLAYER_GROUND_Y - PLAYER_HALF) {
      setFrame = g;
      break;
    }
  }
  if (setFrame < 0) {
    return null;
  }
  var p = traj[setFrame];
  // 그 프레임까지 갈 수 있는 x 범위
  var travel = PLAYER_SPEED * (setFrame - lag);
  var best = null;

  for (var off = -PLAYER_HALF; off <= PLAYER_HALF; off += SET_OFFSET_STEP) {
    var standX = clamp(p.x + off, reachMin, reachMax);
    if (Math.abs(standX - myX) > travel) {
      continue; // 그 자리까지 못 간다
    }
    if (Math.abs(p.x - standX) > PLAYER_HALF) {
      continue; // 그 자리에선 공에 안 닿는다
    }
    var bv = bodyReturnVelocity(p.x, p.vy, standX);
    var setTraj = simulateFrom(p.x, p.y, bv.vx, bv.vy);
    // 세팅 공이 내 코트에 남아야 세팅이다 (넘어가면 그건 그냥 리턴)
    var end = setTraj[setTraj.length - 1];
    if (isLeft ? end.x >= NET_X : end.x <= NET_X) {
      continue;
    }
    var follow = findJumpContact(setTraj, 1, standX, isLeft, reachMin, reachMax);
    if (follow === null) {
      continue; // 띄워놓고 못 친다 — 최악이다
    }
    var hit = chooseHit(
      follow.x,
      follow.y,
      follow.vy,
      follow.x,
      oppOnRight,
      predictOppX(oppX, setFrame + follow.contact, oppOnRight)
    );
    // 세팅을 할 이유는 단 하나 — 급강하 스매시(y=1)를 꽂을 수 있게 되는 것뿐이다.
    // 급강하는 네트에서 약 35px 안에서 쳐야만 넘어간다 (그보다 멀면 공이
    // 네트 상단 판정에 걸리거나 자기 코트에 꽂힌다). 이어지는 수가 급강하가
    // 아니라면 세팅은 30~40프레임을 상대에게 그냥 준 셈이므로 하지 않는다.
    if (hit.hit !== 1 || hit.yDir !== 1) {
      continue;
    }
    if (best === null || hit.score > best.score) {
      best = { standX: standX, score: hit.score, frame: setFrame };
    }
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

function think(s) {
  var isLeft = s.side !== 'RIGHT';
  var lag = LAG_FRAMES;

  var myX = s.self.x;
  var myState = s.self.state;
  var oppX = s.opp.x;

  var courtMin = isLeft ? 0 : NET_X;
  var courtMax = isLeft ? NET_X : GROUND_WIDTH;
  var standbyX = (courtMin + courtMax) / 2;
  // 플레이어가 실제로 설 수 있는 x 범위 (엔진이 이 밖으로는 못 나가게 막는다)
  var reachMin = courtMin + PLAYER_HALF;
  var reachMax = courtMax - PLAYER_HALF;

  var traj = simulateFrom(
    s.ball.x,
    s.ball.y,
    s.ball.xVelocity,
    s.ball.yVelocity
  );
  var landIdx = traj.length - 1;
  var landX = traj[landIdx].x;
  var landsOnMySide = landX > courtMin && landX < courtMax;
  var canStillSet = possessionTouches < MAX_SET_TOUCHES;

  // 공이 상대 쪽으로 갈 때의 수비 목표 (예측 수비 실패 시 코트 중앙)
  var defenseX = standbyX;
  // 예측 수비의 신뢰도는 상대의 상태에 달려 있다. 점프(state 1·2)는 공격
  // 확정 신호라 접촉점·위협 집합이 거의 그대로 실현되므로 예측을 전량
  // 반영한다. 지상의 상대는 언제 어디서 칠지 자유도가 커서 예측이 자주
  // 빗나가므로, 예측 위치와 중앙 대기의 혼합만 반영한다 (선점 시간은 얻되
  // 빗나간 예측의 손해는 절반으로).
  if (DEF_PREDICT === 1 && !landsOnMySide) {
    var plan = planDefense(traj, lag, myX, isLeft, reachMin, reachMax, oppX);
    if (plan !== null) {
      var trust =
        s.opp.state === 1 || s.opp.state === 2 ? 1 : DEF_GROUND_TRUST;
      defenseX = standbyX + trust * (plan.x - standbyX);
    }
  }

  // ── 공중: 공을 따라가며 접촉 시점을 잡아 처리 ────────────────
  if (myState === 1 || myState === 2) {
    var n = jumpPhase(s.self.y, prevSelfY);
    var contact = -1;
    if (n >= 0) {
      for (var f = lag; f < traj.length && f - lag <= 24; f++) {
        var q = traj[f];
        if (isLeft ? q.x >= NET_X : q.x <= NET_X) {
          continue; // 상대 코트의 공은 접촉 후보가 아니다
        }
        if (Math.abs(q.y - jumpYAt(n + f)) > PLAYER_HALF) {
          continue;
        }
        var canBe = clamp(q.x, myX - PLAYER_SPEED * f, myX + PLAYER_SPEED * f);
        canBe = clamp(canBe, reachMin, reachMax);
        if (Math.abs(q.x - canBe) > PLAYER_HALF) {
          continue;
        }
        contact = f;
        break;
      }
    }

    var xToBall = trackX(traj[Math.min(lag, landIdx)].x, myX);

    // v4의 결함 수정: 내가 더 칠 수 없는 공(상대 코트로 떠나감)은 쫓지 않고
    // 즉시 수비 위치로 걸어간다. v4는 반격 직후 공중에서 떠나가는 공을 따라
    // 네트까지 가버려서, 재반격이 깊은 코너에 꽂힐 때 절대 못 돌아온다.
    // (v4에서 이 결함이 안 고쳐졌던 이유: 떠나가는 공에도 x·y가 우연히 맞는
    //  프레임이 있어 contact >= 0 이 되고, onMySideAtContact 체크만 실패한 뒤
    //  맨 아래의 "공 추적"으로 떨어졌다. 위에서 접촉 후보를 내 코트로 제한하고
    //  여기서 명시적으로 복귀를 처리한다.)
    if (DEF_AIR === 1 && contact < 0 && !landsOnMySide) {
      return { x: walkTo(defenseX, myX), y: 0, hit: 0 };
    }

    if (contact >= 0 && contact <= lag + HIT_LEAD_FRAMES) {
      var c = traj[contact];
      var onMySideAtContact = isLeft ? c.x < NET_X : c.x > NET_X;
      if (onMySideAtContact) {
        var best = chooseHit(
          c.x,
          c.y,
          c.vy,
          myX,
          isLeft,
          predictOppX(oppX, contact, isLeft)
        );
        // 공중에서도 세팅이 가능하다: 파워히트를 안 쓰면 공이 위로 뜨므로
        // (몸통 리턴 vy = -max(|vy|,15)) 그걸 받아 다시 친다.
        if (canStillSet && best.score < 0) {
          var air = simulateFrom(
            c.x,
            c.y,
            bodyReturnVelocity(c.x, c.vy, myX).vx,
            bodyReturnVelocity(c.x, c.vy, myX).vy
          );
          var airEnd = air[air.length - 1];
          var staysOurs = isLeft ? airEnd.x < NET_X : airEnd.x > NET_X;
          if (staysOurs) {
            var af = findJumpContact(air, 1, myX, isLeft, reachMin, reachMax);
            if (af !== null) {
              var ah = chooseHit(
                af.x,
                af.y,
                af.vy,
                af.x,
                isLeft,
                predictOppX(oppX, contact + af.contact, isLeft)
              );
              if (
                ah.hit === 1 &&
                ah.yDir === 1 &&
                ah.score > best.score + SET_MIN_GAIN
              ) {
                return { x: xToBall, y: 0, hit: 0 }; // 파워히트를 참고 띄운다
              }
            }
          }
        }
        if (best.hit === 1) {
          // |x|=1이면 공 속도가 2배. 부호는 공 쪽으로 두어 정렬을 유지한다.
          var hx = best.xMag === 0 ? 0 : xToBall !== 0 ? xToBall : 1;
          return { x: hx, y: best.yDir, hit: 1 };
        }
        return { x: xToBall, y: 0, hit: 0 };
      }
    }
    return { x: xToBall, y: 0, hit: 0 };
  }

  // ── 땅에 있고 공이 상대 쪽으로 갈 때: 예측 수비 위치로 ───────
  if (!landsOnMySide) {
    return { x: walkTo(defenseX, myX), y: 0, hit: 0 };
  }

  // ── 땅에 있고 공이 내 쪽으로 올 때 ───────────────────────────
  // (a) 바로 점프 스매시  vs  (b) 세팅 후 스매시 — 2수 앞까지 보고 고른다
  // 접촉 시점을 "가장 이른 것"으로 고정하면, 조금 늦게 쳐서 네트 앞에서
  // 급강하를 꽂을 수 있는 기회를 버리게 된다. 후보를 모아 전부 평가한다.
  var candidates = findJumpContacts(
    traj,
    lag,
    myX,
    isLeft,
    reachMin,
    reachMax,
    CONTACT_CANDIDATES
  );
  var direct = null;
  var directScore = -1e9;
  for (var ci = 0; ci < candidates.length; ci++) {
    var cand = candidates[ci];
    var cs = chooseHit(
      cand.x,
      cand.y,
      cand.vy,
      cand.x,
      isLeft,
      predictOppX(oppX, cand.contact, isLeft)
    ).score;
    // 이른 접촉이 기본. 늦추는 건 확실히 더 좋을 때만 (예측 오차에 취약하므로).
    if (direct === null || cs > directScore + CONTACT_GAIN) {
      directScore = cs;
      direct = cand;
    }
  }

  var set = canStillSet
    ? planSet(traj, lag, myX, isLeft, reachMin, reachMax, isLeft, oppX)
    : null;

  if (set !== null && set.score > directScore + SET_MIN_GAIN) {
    // 세팅: 계산된 자리로 걸어가 몸으로 받는다. 점프도 파워히트도 하지 않는다.
    return { x: walkTo(set.standX, myX), y: 0, hit: 0 };
  }

  if (direct !== null) {
    var walk = walkTo(clamp(direct.x, reachMin, reachMax), myX);
    // 이 tick의 입력은 lag 프레임 뒤부터 3프레임 동안 유지된다.
    if (direct.jumpAt <= lag + 2) {
      return { x: walk, y: -1, hit: 0 };
    }
    return { x: walk, y: 0, hit: 0 };
  }

  // ── 점프도 세팅도 안 되는 경우: 몸으로 받기만 ────────────────
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

  // ── 점유 중 접촉 횟수 추적 ────────────────────────────────
  // 규칙상 한 진영에서 5회째 접촉하면 실점한다. 세팅은 1회만 쓰고,
  // 그 다음부터는 무조건 넘기는 쪽으로 판단하게 한다.
  var isLeft = s.side !== 'RIGHT';
  var onMySide = isLeft ? s.ball.x < NET_X : s.ball.x > NET_X;
  if (prevOnMySide !== null && onMySide !== prevOnMySide) {
    possessionTouches = 0; // 네트를 넘었으니 점유가 바뀌었다
  }
  // 내 코트에서 공이 떨어지다가 위로 뜨면 내가 댄 것이다.
  if (onMySide && prevBallVy > 0 && s.ball.yVelocity < 0) {
    possessionTouches++;
  }
  prevOnMySide = onMySide;

  // ── 랠리 시작 전 "정지 구간" 처리 (이걸 빼먹으면 서브를 통째로 놓친다) ──
  // 득점 후 게임은 afterEndOfRound(5프레임) → beforeStartOfNextRound(30프레임)
  // 동안 physics를 돌리지 않는데 decide는 계속 호출된다. 그 얼어붙은 스냅샷을
  // 보고 "지금 점프"라고 답하면 그 입력이 랠리 첫 프레임에 그대로 적용되어
  // 공이 오기 30프레임 전에 점프해버린다 (점프는 33프레임이면 끝난다).
  var frozen =
    (s.ball.x === prevBallX && s.ball.y === prevBallY) || s.ball.y === 0;
  if (frozen) {
    possessionTouches = 0;
  }
  prevBallX = s.ball.x;
  prevBallY = s.ball.y;
  prevBallVy = s.ball.yVelocity;

  // 상대 속도 추정 (프레임당). decide는 3프레임마다 호출되므로 /3.
  // 정지 구간에서는 위치가 안 변하므로 갱신하지 않고 0으로 둔다.
  if (!frozen && prevOppX >= 0) {
    var dv = (s.opp.x - prevOppX) / 3;
    oppVelPerFrame = dv > PLAYER_SPEED ? PLAYER_SPEED : dv < -PLAYER_SPEED ? -PLAYER_SPEED : dv;
  } else {
    oppVelPerFrame = 0;
  }
  prevOppX = s.opp.x;

  var action;
  try {
    action = think(s);
  } catch (e) {
    action = fallback(s);
  }
  prevSelfY = s.self.y;

  if (frozen) {
    // 좌우 이동만 남긴다. 정지 중엔 반영되지 않지만, 랠리 첫 프레임부터
    // 걸어갈 수 있어 오히려 이득이다.
    return { x: action.x, y: 0, hit: 0 };
  }
  return action;
}
