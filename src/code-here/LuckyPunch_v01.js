'use strict';

// LuckyPunch v1 -- 베이스라인 (수비/위치잡기 전용, 파워히트 없음)
//
// 이 버전의 목적은 "세팅이 끝났고 파이프라인이 돈다"를 확인하는 것.
// 공격(hit) 로직은 v2부터 얹는다.
//
// decide(s)는 매 tick(3프레임 = 120ms) 한 번 호출되고,
// { x, y, hit } 세 필드가 그 tick 동안의 조작이 된다.
//   x   : -1 왼쪽 / 0 가만히 / 1 오른쪽
//   y   : -1 위(지상이면 점프, 파워히트 중이면 아치 스매시)
//          0 가만히 / 1 아래(하방 강스매시, 지상+x!=0이면 다이빙)
//   hit : 0 안 함 / 1 파워히트(또는 다이빙 트리거)

// ── 게임판 상수 (원작 픽셀 단위 그대로) ──────────────────────
// y는 아래로 갈수록 커진다. "바닥이 0"이 아니다.
var GROUND_WIDTH = 432; // 코트 전체 폭 (x: 0 ~ 432)
var NET_X = 216; // 네트 x좌표 = GROUND_HALF_WIDTH
var PLAYER_GROUND_Y = 244; // 플레이어가 땅에 서 있을 때의 y
var BALL_GROUND_Y = 252; // 공이 땅에 닿았을 때의 y
var BALL_RADIUS = 20;
var PLAYER_HALF_LENGTH = 32; // 플레이어 히트박스 반폭·반높이
var NET_PILLAR_HALF_WIDTH = 25; // 네트 기둥은 x = 216 ± 25
var NET_PILLAR_TOP_TOP_Y = 176; // 네트 기둥 상단 y


// ── 튜닝 파라미터 ────────────────────────────────────────────
var RECEIVE_OFFSET = 12; // 낙하지점에서 네트 반대쪽으로 물러설 픽셀
var WALK_DEADBAND = 6; // 이 안쪽이면 안 움직임 (1 tick 지연 진동 억제)
var JUMP_BALL_HIGH_Y = 150; // 이보다 공이 높아야(y가 작아야) 점프 고려
var JUMP_BALL_MAX_XVEL = 5; // 공 옆속도가 이보다 빠르면 점프해도 놓침

function decide(s) {
  // 내가 LEFT인지 RIGHT인지에 따라 "네트 쪽"의 부호가 뒤집힌다.
  // 대진에서 어느 쪽에 배정될지 모르므로 절대 하드코딩하지 않는다.
  var towardNet = s.side === 'RIGHT' ? -1 : 1;

  var ownNearBoundary = s.side === 'RIGHT' ? NET_X : 0;
  var ownFarBoundary = s.side === 'RIGHT' ? GROUND_WIDTH : NET_X;
  var standbyX = (ownNearBoundary + ownFarBoundary) / 2;

  // expectedLandingPointX = 엔진이 매 프레임 다시 계산해 주는 예상 낙하지점.
  // 누가 공을 다시 치면 값이 확 바뀌므로 캐시하지 말고 매 tick 새로 읽는다.
  var landingX = s.ball.expectedLandingPointX;
  var landingOnOwnSide = landingX > ownNearBoundary && landingX < ownFarBoundary;

  var targetX;
  if (landingOnOwnSide) {
    // 낙하지점 정중앙에 서면 공이 내 몸 위로 곧장 튀어 내 코트에 다시 떨어진다.
    // 살짝 네트 반대쪽에 서서 몸의 "네트 쪽 면"으로 받아야 네트를 넘어간다.
    targetX = landingX - towardNet * RECEIVE_OFFSET;
  } else {
    // 아직 상대 코트에 공이 있다. 네트에 붙어 있으면 넘어온 순간 대응이 안 되므로
    // 내 코트 중앙까지 물러나 대기한다.
    targetX = standbyX;
  }

  var dx = targetX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > WALK_DEADBAND) {
    x = dx > 0 ? 1 : -1;
  }

  // 점프는 엄격하게. 어설프게 뛰면 착지하는 사이에 공이 지나가 버린다.
  // (플레이어 히트박스가 상하 32픽셀이라 어지간한 높이는 서서도 받힌다.)
  var y = 0;
  var xAligned = Math.abs(s.ball.x - s.self.x) < PLAYER_HALF_LENGTH;
  var ballSlowSideways = Math.abs(s.ball.xVelocity) < JUMP_BALL_MAX_XVEL;
  var ballClearlyHigh = s.ball.y < JUMP_BALL_HIGH_Y;
  if (
    s.self.state === 0 && // 지상(state 0)에서만 점프가 발동한다
    xAligned &&
    ballSlowSideways &&
    ballClearlyHigh &&
    s.ball.yVelocity > 0 // yVelocity > 0 = 내려오는 중
  ) {
    y = -1;
  }

  // v1은 파워히트를 쓰지 않는다. 몸으로만 받아 넘긴다.
  return { x: x, y: y, hit: 0 };
}
