+'use strict';

/*
 * Ditto v1
 * 모든 전술은 "내 코트가 왼쪽, 네트가 오른쪽"인 정규 좌표계에서 판단한다.
 * CourtView가 오른쪽 진영 스냅샷을 좌우 반전하므로 전술 로직은 한 번만 쓴다.
 */

const TUNE = Object.freeze({
  width: 432,
  netX: 216,
  netHalf: 25,
  netTopY: 176,
  playerHalf: 32,
  groundY: 244,
  ballGroundY: 252,
  ownMinX: 32,
  ownMaxX: 184,
  walkPerFrame: 6,
  divePerFrame: 8,
  gravity: 1,

  moveDeadband: 5,
  receiveOffsets: [18, 24, 30],
  overheadVelocityMax: 2,
  overheadOffset: 28,
  receiveMinY: 150,
  receiveIdealY: 190,
  homeX: 124,
  frontPowerGuardX: 148,
  diveHorizon: 14,
  diveMargin: 6,

  jumpDistance: 50,
  jumpMinY: 120,
  jumpMaxY: 210,
  powerDistance: 72,
  powerMaxBallY: 210,
  powerSafeSelfY: 210,
  opponentReactionFrames: 3,
  forecastFrames: 96,
});

/*
 * 신규 스킬 공개 당일의 유일한 확장 지점이다.
 * 공식 API가 확정되기 전에는 알 수 없는 필드나 입력을 절대 추측하지 않는다.
 */
class SkillAdapter {
  /** 스냅샷의 스킬 관련 필드를 안전하게 읽는다. */
  read(snapshot) {
    const skill = snapshot.skill || snapshot.skills || snapshot.meta.skill || {};
    return {
      gauge: Number.isFinite(skill.gauge) ? skill.gauge : 0,
      cooldown: Number.isFinite(skill.cooldown) ? skill.cooldown : 0,
      ready: Boolean(skill.ready),
      name: typeof skill.name === 'string' ? skill.name : '',
    };
  }

  /** 공식 문서가 나온 뒤에만 스킬 액션으로 일반 계획을 대체한다. */
  override(_view, _plan, _skill) {
    return null;
  }
}

/*
 * 원본 스냅샷을 정규 좌표계로 바꾸고, 마지막에 다시 원래 진영 기준으로 되돌린다.
 */
class CourtView {
  /** 원본 스냅샷에서 정규화된 전술 관측치를 만든다. */
  constructor(snapshot) {
    this.flipped = snapshot.side === 'RIGHT';
    this.tickGroup = Math.max(1, snapshot.config.tickFrameGroupSize | 0);
    this.self = this.player(snapshot.self);
    this.opp = this.player(snapshot.opp);
    this.ball = {
      x: this.x(snapshot.ball.x),
      y: snapshot.ball.y,
      vx: this.vx(snapshot.ball.xVelocity),
      vy: snapshot.ball.yVelocity,
      landingX: this.x(snapshot.ball.expectedLandingPointX),
      isPowerHit: Boolean(snapshot.ball.isPowerHit),
    };
    this.score = snapshot.meta.score;
  }

  /** 화면 x좌표를 내 코트가 왼쪽인 좌표로 변환한다. */
  x(value) {
    return this.flipped ? TUNE.width - value : value;
  }

  /** 수평 속도 또는 방향을 정규 좌표계로 변환한다. */
  vx(value) {
    return this.flipped ? -value : value;
  }

  /** 플레이어 정보를 정규 좌표계로 변환한다. */
  player(player) {
    return {
      x: this.x(player.x),
      y: player.y,
      state: player.state | 0,
      frame: player.frameNumber | 0,
      divingDirection: this.vx(player.divingDirection | 0),
    };
  }

  /** 엔진의 예상 착지점이 내 코트에 속하는지 판별한다. */
  landsOnOwnCourt() {
    return this.ball.landingX >= 0 && this.ball.landingX < TUNE.netX;
  }

  /** 정규 좌표계의 입력을 실제 내 진영에 맞는 입력으로 되돌린다. */
  output(action) {
    return {
      x: this.flipped ? -action.x : action.x,
      y: action.y,
      hit: action.hit,
    };
  }
}

/*
 * 엔진의 공개 물리를 그대로 따라가는 가벼운 공 궤적 예측기다.
 * 예상 착지점뿐 아니라 "언제 어느 높이에서 닿는가"를 구하는 데 쓴다.
 */
class BallForecast {
  /** 독립적으로 시뮬레이션할 공 상태를 복사한다. */
  constructor(ball) {
    this.ball = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  }

  /** 공을 한 게임 프레임 진행하고 그 프레임의 위치를 반환한다. */
  step() {
    const ball = this.ball;
    if (ball.x + ball.vx < 0 || ball.x + ball.vx > TUNE.width) ball.vx = -ball.vx;
    if (ball.y + ball.vy < 0) ball.vy = 1;

    if (Math.abs(ball.x - TUNE.netX) < TUNE.netHalf && ball.y > TUNE.netTopY) {
      if (ball.y <= TUNE.netTopY + 16) {
        if (ball.vy > 0) ball.vy = -ball.vy;
      } else if (ball.x < TUNE.netX) {
        ball.vx = -Math.abs(ball.vx);
      } else {
        ball.vx = Math.abs(ball.vx);
      }
    }

    ball.y += ball.vy;
    if (ball.y > TUNE.ballGroundY) {
      ball.y = TUNE.ballGroundY;
      return { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, ground: true };
    }
    ball.x += ball.vx;
    ball.vy += TUNE.gravity;
    return { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, ground: false };
  }

  /** 착지하거나 제한 프레임에 도달할 때까지 전체 경로를 만든다. */
  frames(limit = TUNE.forecastFrames) {
    const path = [];
    for (let frame = 1; frame <= limit; frame += 1) {
      const point = this.step();
      point.frame = frame;
      path.push(point);
      if (point.ground) break;
    }
    return path;
  }
}

/*
 * 공중 파워히트 후보를 실제 공개 규칙(느림/빠름, 위/직선/아래)으로 평가한다.
 */
class ShotPlanner {
  /** 한 파워히트 후보가 상대 코트에 안전하게 도달하는지 점수화한다. */
  evaluate(view, fast, vertical) {
    const speedY = Math.max(15, Math.abs(view.ball.vy)) * 2;
    const path = new BallForecast({
      x: view.ball.x,
      y: view.ball.y,
      vx: fast ? 20 : 10,
      vy: vertical === 0 ? 0 : speedY * vertical,
    }).frames();
    const landing = path[path.length - 1];

    if (!landing || !landing.ground || landing.x <= TUNE.netX + 8) return null;
    const crossedNet = path.some((point) => point.x > TUNE.netX && point.y < TUNE.ballGroundY);
    if (!crossedNet) return null;

    const opponentCanReach = path.some((point) => {
      if (point.x <= TUNE.netX || point.y < 70 || point.y > 220) return false;
      const reactionFrames = Math.max(0, point.frame - TUNE.opponentReactionFrames);
      const reach = TUNE.playerHalf + reactionFrames * TUNE.walkPerFrame;
      return Math.abs(point.x - view.opp.x) <= reach;
    });
    const edgeDistance = Math.min(Math.abs(landing.x - 248), Math.abs(400 - landing.x));
    const score =
      Math.abs(landing.x - view.opp.x) * 1.4 +
      edgeDistance * 0.3 -
      landing.frame * 1.8 -
      (opponentCanReach ? 85 : 0) +
      (fast ? 8 : 0);

    return { score, action: { x: fast ? 1 : 0, y: vertical, hit: 1 } };
  }

  /** 가능한 여섯 파워히트 중 가장 높은 점수의 입력을 고른다. */
  bestPower(view) {
    let best = null;
    for (const fast of [false, true]) {
      for (const vertical of [-1, 0, 1]) {
        const candidate = this.evaluate(view, fast, vertical);
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
      }
    }
    return best ? best.action : null;
  }
}

/*
 * 상대가 네트 앞에서 파워히트를 준비할 때의 최악 착지점을 미리 계산한다.
 * 실제 공격 전에도 가능한 각도를 모두 보므로 한 tick 지연을 보완할 수 있다.
 */
class ThreatPlanner {
  /** 상대 파워히트의 가능한 내 코트 착지 후보를 만든다. */
  powerLandings(view) {
    const landings = [];
    const speedY = Math.max(15, Math.abs(view.ball.vy)) * 2;
    for (const fast of [false, true]) {
      for (const vertical of [-1, 0, 1]) {
        const path = new BallForecast({
          x: view.ball.x,
          y: view.ball.y,
          vx: fast ? -20 : -10,
          vy: vertical === 0 ? 0 : speedY * vertical,
        }).frames();
        const landing = path[path.length - 1];
        if (landing && landing.ground && landing.x >= 0 && landing.x < TUNE.netX) {
          landings.push(landing);
        }
      }
    }
    return landings;
  }

  /** 현재 위치에서 모든 위협에 가장 덜 늦는 대기 x좌표를 고른다. */
  safestStandX(view, delayedX, landings) {
    let bestX = TUNE.homeX;
    let bestWorstMiss = Infinity;
    for (let x = TUNE.ownMinX; x <= TUNE.ownMaxX; x += 4) {
      let worstMiss = -Infinity;
      for (const landing of landings) {
        const available = Math.max(0, landing.frame - view.tickGroup);
        const reachable = TUNE.playerHalf + available * TUNE.walkPerFrame;
        const miss = Math.abs(landing.x - x) - reachable;
        if (miss > worstMiss) worstMiss = miss;
      }
      // 같은 안전도라면 현재 지연 보정 위치와 가까운 곳을 선택한다.
      if (
        worstMiss < bestWorstMiss ||
        (worstMiss === bestWorstMiss && Math.abs(x - delayedX) < Math.abs(bestX - delayedX))
      ) {
        bestWorstMiss = worstMiss;
        bestX = x;
      }
    }
    return bestX;
  }
}

/*
 * 수비, 리시브, 점프, 파워히트, 다이빙의 우선순위를 결정한다.
 */
class TacticalController {
  /** 계획기와 파워히트 평가기를 초기화한다. */
  constructor() {
    this.shots = new ShotPlanner();
    this.threats = new ThreatPlanner();
    // decide()의 결과는 약 한 tick 뒤에 반영된다. 직전 입력을 기억해
    // 새 입력이 실제로 시작될 때의 위치를 보정한다.
    this.lastAction = { x: 0, y: 0, hit: 0 };
    this.lastScoreKey = null;
  }

  /** 모든 경로에서 엔진 허용 입력 범위만 반환하도록 보정한다. */
  action(x = 0, y = 0, hit = 0) {
    return {
      x: x < 0 ? -1 : x > 0 ? 1 : 0,
      y: y < 0 ? -1 : y > 0 ? 1 : 0,
      hit: hit ? 1 : 0,
    };
  }

  /** 파이프라인 지연 뒤에 플레이어가 있을 x좌표를 추정한다. */
  delayedX(view) {
    if (view.self.state > 1 || this.lastAction.hit) return view.self.x;
    const drift = this.lastAction.x * TUNE.walkPerFrame * view.tickGroup;
    return this.clampOwnX(view.self.x + drift);
  }

  /** 지연이 반영된 시작 위치에서 목표까지 걸어갈 한 방향 입력을 구한다. */
  moveTo(view, target) {
    const distance = target - this.delayedX(view);
    if (Math.abs(distance) <= TUNE.moveDeadband) return 0;
    return distance > 0 ? 1 : -1;
  }

  /** 이번 결정의 입력을 기억해 다음 tick의 지연 보정에 사용한다. */
  remember(action) {
    this.lastAction = { x: action.x, y: action.y, hit: action.hit };
  }

  /** 득점으로 라운드가 초기화되면 이전 랠리의 이동 관성을 버린다. */
  observeRound(view) {
    const scoreKey = view.score.self + ':' + view.score.opp;
    if (this.lastScoreKey !== null && this.lastScoreKey !== scoreKey) {
      this.lastAction = { x: 0, y: 0, hit: 0 };
    }
    this.lastScoreKey = scoreKey;
  }

  /** 목표 x를 내 플레이어가 이동 가능한 코트 범위로 제한한다. */
  clampOwnX(x) {
    return Math.max(TUNE.ownMinX, Math.min(TUNE.ownMaxX, x));
  }

  /*
   * 하강 중인 공의 실제 접촉 지점을 고른다.
   * 착지점만 따라가면 자가 토스나 네트 쿠션 뒤의 공을 머리 위에서 놓치므로,
   * 닿을 수 있는 가장 이른 하강 지점의 네트 반대편에 서도록 한다.
   */
  receiveTarget(view, path) {
    // 일반 수비는 엔진의 정확한 예상 착지점을 따르는 편이 가장 안정적이다.
    // 단, 내 쪽으로 되돌아오는 자가 토스/네트 쿠션 공은 실제 접촉점을 찾는다.
    const overheadBall = Math.abs(view.ball.vx) <= TUNE.overheadVelocityMax;
    if (overheadBall) {
      // 수직 낙하는 플레이어 중심에 서면 랜덤 수평 반사 또는 자가 토스가 난다.
      // 공보다 확실히 왼쪽(네트 반대편)에 서서 양의 수평 속도를 강제한다.
      const descending = path.find(
        (point) => point.frame >= view.tickGroup + 2 &&
          point.x < TUNE.netX && point.vy > 0 && point.y >= TUNE.receiveMinY
      );
      const contactX = descending ? descending.x : view.ball.landingX;
      return this.clampOwnX(contactX - TUNE.overheadOffset);
    }

    const recoveryBall = view.ball.x < TUNE.netX && view.ball.vx < 0;
    if (!recoveryBall) {
      const lead = Math.max(-12, Math.min(12, view.ball.vx * view.tickGroup));
      return this.clampOwnX(view.ball.landingX - TUNE.receiveOffsets[2] - lead * 0.25);
    }

    let best = null;
    const delayedStartX = this.delayedX(view);
    const inputDelay = view.tickGroup;

    for (const point of path) {
      // 현재 반환값은 한 tick 뒤에 반영된다. 그 전의 접촉점은 이미 늦었다.
      if (point.frame < inputDelay + 2 || point.x < 0 || point.x >= TUNE.netX) continue;
      if (point.vy <= 0 || point.y < TUNE.receiveMinY || point.y > TUNE.ballGroundY) continue;

      for (const offset of TUNE.receiveOffsets) {
        const target = this.clampOwnX(point.x - offset);
        const usableFrames = Math.max(0, point.frame - inputDelay);
        const reach = TUNE.playerHalf + usableFrames * TUNE.walkPerFrame;
        const distance = Math.abs(target - delayedStartX);
        if (distance > reach) continue;

        // 빠른 접촉을 우선하되, 너무 높은 공보다 몸통 중앙 근처의 접촉을 선호한다.
        const score =
          200 -
          point.frame * 2 -
          Math.abs(point.y - TUNE.receiveIdealY) * 0.25 -
          distance * 0.15 +
          offset * 0.2;
        if (!best || score > best.score) best = { score, target };
      }
    }

    if (best) return best.target;

    // 예측이 불완전한 경우에도 공개된 예상 착지점으로 안전하게 폴백한다.
    return this.clampOwnX(view.ball.landingX - TUNE.receiveOffsets[1]);
  }

  /** 걷기로 늦고 다이빙으로는 닿을 수 있는 낮은 공에서만 다이빙한다. */
  shouldDive(view, landing) {
    if (!landing || view.self.state !== 0 || landing.frame > TUNE.diveHorizon) return false;
    if (view.ball.y < 164 && view.ball.vy < 8) return false;

    const distance = Math.abs(landing.x - this.delayedX(view));
    // 이미 한두 걸음 안의 공은 다이빙보다 일반 충돌이 안전하다. 다이빙은
    // 충돌 후에도 누워 있는 시간이 있어 Pika의 연속 공격에 특히 취약하다.
    if (distance <= TUNE.playerHalf + 16) return false;
    const walkReach =
      TUNE.playerHalf + Math.max(0, landing.frame - view.tickGroup) * TUNE.walkPerFrame;
    const diveReach = TUNE.playerHalf + Math.max(0, landing.frame - 1) * TUNE.divePerFrame;
    return distance > walkReach + TUNE.diveMargin && distance <= diveReach + TUNE.diveMargin;
  }

  /** 근접한 하강 공만 점프해 공중 파워히트 기회를 만든다. */
  jumpPlan(view, path) {
    if (view.self.state !== 0) return null;
    // 수직 낙하 공은 먼저 몸통 리시브로 확실히 네트 방향 반사를 만든다.
    if (Math.abs(view.ball.vx) <= TUNE.overheadVelocityMax) return null;
    const activationPoint = path.find((point) => point.frame >= view.tickGroup) || view.ball;
    const closeEnough = Math.abs(activationPoint.x - this.delayedX(view)) <= TUNE.jumpDistance;
    const descending = activationPoint.vy > 0;
    const usefulHeight = activationPoint.y >= TUNE.jumpMinY && activationPoint.y <= TUNE.jumpMaxY;
    if (!closeEnough || !descending || !usefulHeight) return null;

    // 착지까지의 경로도 확인해 빈 점프를 피한다.
    for (const point of path) {
      if (point.frame < 3 || point.frame > 12) continue;
      if (point.x < 0 || point.x >= TUNE.netX || point.y > TUNE.jumpMaxY || point.vy <= 0) continue;
      if (Math.abs(point.x - this.delayedX(view)) <= TUNE.jumpDistance + 12) {
        return this.action(this.moveTo(view, point.x), -1, 0);
      }
    }
    return this.action(this.moveTo(view, activationPoint.x), -1, 0);
  }

  /** 공중 상태에서 파워히트를 확실히 발동하고 가장 좋은 각도를 선택한다. */
  powerPlan(view) {
    if (view.self.state !== 1 || view.self.y > TUNE.powerSafeSelfY) return null;

    const closeToBall =
      Math.abs(view.ball.x - view.self.x) <= TUNE.powerDistance &&
      Math.abs(view.ball.y - view.self.y) <= TUNE.powerDistance;
    if (!closeToBall || view.ball.y > TUNE.powerMaxBallY) return null;

    const evaluated = this.shots.bestPower(view);
    if (evaluated) return this.action(evaluated.x, evaluated.y, evaluated.hit);

    // 예측 경로가 긴 아치라 후보가 없더라도, 파워히트 자체는 발동한다.
    // 낮은 공은 직선으로, 네트 근처의 공은 위쪽 아치로 보내는 안전 폴백이다.
    return this.action(1, view.ball.y < 160 ? 0 : -1, 1);
  }

  /** 상대 네트 앞 파워히트의 착지 범위를 우선 방어하고, 그 외에는 중앙 대기한다. */
  defendTarget(view) {
    const opponentNearBall =
      Math.abs(view.opp.x - view.ball.x) <= TUNE.playerHalf + 8 &&
      Math.abs(view.opp.y - view.ball.y) <= TUNE.playerHalf + 8;
    // 상대가 네트 부근에서 점프한 순간에는 아직 공과 겹치지 않았더라도
    // 다음 tick 안에 하방 파워가 나올 수 있다. 이때 중앙 대기는 늦다.
    const opponentInFrontPowerWindow =
      view.opp.x < 320 &&
      view.ball.x > TUNE.netX &&
      view.ball.y < 220 &&
      (view.opp.state === 1 || view.opp.state === 2);
    const opponentCanPower = opponentNearBall || opponentInFrontPowerWindow;
    if (opponentCanPower) {
      const landings = this.threats.powerLandings(view);
      if (landings.length) {
        const minimaxX = this.threats.safestStandX(view, this.delayedX(view), landings);
        // Pika 계열의 네트 앞 빠른 하방 스매시는 코트 중앙보다 앞쪽에
        // 집중된다. 가능한 모든 각도용 minimax 위치와 앞쪽 가드를 섞어
        // 낮고 빠른 공을 우선 살린다.
        if (opponentInFrontPowerWindow) {
          return this.clampOwnX((minimaxX + TUNE.frontPowerGuardX * 2) / 3);
        }
        return minimaxX;
      }
      if (opponentInFrontPowerWindow) return TUNE.frontPowerGuardX;
    }

    // 이미 파워히트가 날아오는 중이면 엔진의 계산된 착지점으로 즉시 복귀한다.
    if (view.ball.isPowerHit && view.ball.vx < 0 && view.landsOnOwnCourt()) {
      return this.clampOwnX(view.ball.landingX - TUNE.receiveOffsets[2]);
    }

    if (!opponentNearBall) return TUNE.homeX;

    const likelyReturnX = TUNE.width - view.opp.x;
    return this.clampOwnX((TUNE.homeX * 2 + likelyReturnX) / 3);
  }

  /** 현재 상태에 맞춰 공격, 수비, 리시브 중 하나의 입력을 우선순위대로 선택한다. */
  plan(view) {
    this.observeRound(view);
    // 다이빙/누움/점수 포즈는 엔진이 입력을 무시하므로 중립 입력으로 둔다.
    if (view.self.state >= 3) return this.action();

    const power = this.powerPlan(view);
    if (power) return power;

    const path = new BallForecast(view.ball).frames();
    if (!view.landsOnOwnCourt()) {
      return this.action(this.moveTo(view, this.defendTarget(view)), 0, 0);
    }

    const landing = path.find((point) => point.ground) || null;
    const jump = this.jumpPlan(view, path);
    if (jump) return jump;

    if (this.shouldDive(view, landing)) {
      return this.action(this.moveTo(view, landing.x), 0, 1);
    }

    return this.action(this.moveTo(view, this.receiveTarget(view, path)), 0, 0);
  }
}

/*
 * 엔진이 한 번만 로드하는 봇 인스턴스다. decide 밖의 객체 상태는 틱 사이에 유지된다.
 */
class DittoBot {
  /** 스킬 어댑터와 전술 컨트롤러를 조립한다. */
  constructor() {
    this.skills = new SkillAdapter();
    this.controller = new TacticalController();
  }

  /** 스냅샷을 계획하고 최종 엔진 입력 객체로 반환한다. */
  decide(snapshot) {
    const view = new CourtView(snapshot);
    const plan = this.controller.plan(view);
    const skillPlan = this.skills.override(view, plan, this.skills.read(snapshot));
    const action = skillPlan || plan;
    this.controller.remember(action);
    return view.output(action);
  }
}

const bot = new DittoBot();

/** 대회 엔진이 매 틱 호출하는 필수 진입점이다. */
function decide(snapshot) {
  return bot.decide(snapshot);
}
