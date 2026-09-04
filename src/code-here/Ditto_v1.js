+'use strict';

/*
 * Ditto v1
 * A self-contained Pikachu Volleyball controller.
 *
 * The planner uses a canonical court: our side is always the left half and the
 * net is always to the right. CourtView mirrors RIGHT-side snapshots at the
 * boundary, keeping every tactical rule side-independent.
 */

const STATICS = {
  GROUND_WIDTH: 432,
  GROUND_HALF_WIDTH: 216,
  
  PLAYER_TOUCHING_GROUND_Y_COORD: 244,
  BALL_TOUCHING_GROUND_Y_COORD: 252,
  BALL_RADIUS: 20,
  
  NET_PILLAR_HALF_WIDTH: 25,
  NET_PILLAR_TOP_TOP_Y_COORD: 176,
  PLAYER_HALF_LENGTH: 32,
}

// Tournament-day tuning and first place to adjust response timing.
const TUNE = Object.freeze({
  ...STATICS,
  playerMinX: STATICS.PLAYER_HALF_LENGTH,
  playerMaxX: STATICS.GROUND_HALF_WIDTH - STATICS.PLAYER_HALF_LENGTH,
  walkPerFrame: 6,
  gravity: 1,
  moveDeadband: 5,
  receiveOffset: 18,
  homeX: 108,
  emergencyFrames: 14,
  jumpBallY: 178,
  jumpDistance: 38,
  powerDistance: 38,
  powerMaxY: 174,
  forecastFrames: 72,
});

/* 당일 게이지/쿨다운/신규 액션 대응 지점 */
// [SKILL DAY] New fields/actions belong in this adapter. Keeping it separate
// means a future gauge or cooldown does not contaminate the core controller.
class SkillAdapter {
  read(snapshot) {
    const skill = snapshot.skill || snapshot.skills || {};
    return {
      gauge: Number.isFinite(skill.gauge) ? skill.gauge : 0,
      cooldown: Number.isFinite(skill.cooldown) ? skill.cooldown : 0,
      ready: Boolean(skill.ready),
    };
  }

  // Return null to retain the ordinary action. Add only documented actions.
  // const override = this.skills.override(view, plan, this.skills.read(snapshot));
  // _view: Bot을 왼쪽으로 강제한 좌표계, _plan: TacticalController의 plan, _skill: SkillAdapter
  override(_view, _plan, _skill) {
    return null;
  }
}

// 좌·우 진영을 하나의 좌표계로 정규화
// 이건 왠만해서 손댈 일 없지만 특정 skill 추가되면 output은 건들기
class CourtView {
  constructor(snapshot) {
    this.raw = snapshot;
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
      power: Boolean(snapshot.ball.isPowerHit),
    };
    this.score = snapshot.meta.score;
  }

  x(value) {
    return this.flipped ? TUNE.GROUND_WIDTH - value : value; // 무조건 현재 bot을 왼쪽에 두기 위한 변환 method
  }
  
  vx(value) {
    return this.flipped ? -value : value; // 무조건 현재 bot을 왼쪽에 두기 위한 변환 method
  }

  player(player) {
    return {
      x: this.x(player.x),
      y: player.y,
      state: player.state | 0,
      frame: player.frameNumber | 0,
      divingDirection: this.vx(player.divingDirection | 0),
    };
  }

  ownLanding() {
    return this.ball.landingX >= 0 && this.ball.landingX < TUNE.GROUND_HALF_WIDTH;
  }

  output(action) {
    return {
      x: this.flipped ? -action.x : action.x,
      y: action.y,
      hit: action.hit,
    };
  }
}

// 착지 시점·높이 판단용 경량 탄도 예측
// Predicts only the ball path needed for tactical timing. The engine already
// supplies landingX; this forecast answers "when and at what height?"
class BallForecast {
  constructor(ball) {
    this.ball = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy };
  }

  step() {
    const ball = this.ball;
    if (ball.x + ball.vx < 0 || ball.x + ball.vx > TUNE.GROUND_WIDTH) {
      ball.vx = -ball.vx;
    }
    if (ball.y + ball.vy < 0) ball.vy = 1;

    if (Math.abs(ball.x - TUNE.GROUND_HALF_WIDTH) < TUNE.NET_PILLAR_HALF_WIDTH && ball.y > TUNE.NET_PILLAR_TOP_TOP_Y_COORD) {
      if (ball.y <= TUNE.NET_PILLAR_TOP_TOP_Y_COORD + 16) {
        if (ball.vy > 0) ball.vy = -ball.vy;
      } else if (ball.x < TUNE.GROUND_HALF_WIDTH) {
        ball.vx = -Math.abs(ball.vx);
      } else {
        ball.vx = Math.abs(ball.vx);
      }
    }

    ball.y += ball.vy;
    if (ball.y > TUNE.BALL_TOUCHING_GROUND_Y_COORD) {
      ball.y = TUNE.BALL_TOUCHING_GROUND_Y_COORD;
      return { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, ground: true };
    }
    ball.x += ball.vx;
    ball.vy += TUNE.gravity;
    return { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, ground: false };
  }

  frames(limit) {
    const result = [];
    for (let frame = 1; frame <= limit; frame += 1) {
      const point = this.step();
      point.frame = frame;
      result.push(point);
      if (point.ground) break;
    }
    return result;
  }
}

// 리시브, 수비 대기, 근접 점프, 파워히트, 긴급 다이빙
class TacticalController {
  constructor() {
    this.previousScore = null;
    this.rallyTouches = 0;
  }

  action(x = 0, y = 0, hit = 0) {
    return {
      x: x < 0 ? -1 : x > 0 ? 1 : 0,
      y: y < 0 ? -1 : y > 0 ? 1 : 0,
      hit: hit ? 1 : 0,
    };
  }

  moveTo(current, target) {
    const distance = target - current;
    if (Math.abs(distance) <= TUNE.moveDeadband) return 0;
    return distance > 0 ? 1 : -1;
  }

  clampOwnX(x) {
    return Math.max(TUNE.playerMinX, Math.min(TUNE.playerMaxX, x));
  }

  updateRally(view) {
    const scoreKey = view.score.self + ':' + view.score.opp;
    if (this.previousScore !== scoreKey) {
      this.rallyTouches = 0;
      this.previousScore = scoreKey;
    }
  }

  firstOwnThreat(path) {
    for (const point of path) {
      if (
        point.x >= 0 &&
        point.x < TUNE.GROUND_HALF_WIDTH &&
        point.y >= 92 &&
        point.y <= TUNE.BALL_TOUCHING_GROUND_Y_COORD
      ) {
        return point;
      }
    }
    return null;
  }

  receiveTarget(view, threat) {
    // Stand on the far-from-net side of the ball. A normal collision then
    // naturally returns the ball toward the net instead of into our back wall.
    const lead = Math.max(-12, Math.min(12, view.ball.vx * view.tickGroup));
    // The exposed landing point already includes walls and net bounces. Use
    // it for the standing position; `threat` is only a timing estimate.
    const landing = view.ball.landingX;
    return this.clampOwnX(landing - TUNE.receiveOffset - lead * 0.25);
  }

  canWalkTo(view, target, frames) {
    const usableFrames = Math.max(0, frames - view.tickGroup);
    const reach = usableFrames * TUNE.walkPerFrame + TUNE.PLAYER_HALF_LENGTH;
    return Math.abs(target - view.self.x) <= reach;
  }

  shouldDive(view, threat) {
    if (!threat || view.self.state !== 0) return false;
    if (threat.frame > TUNE.emergencyFrames || threat.y < 164) return false;
    return !this.canWalkTo(view, threat.x, threat.frame);
  }

  jumpPlan(view, path) {
    if (view.self.state !== 0) return null;
    // A jump commits the player for many frames.  Use the forecast to choose
    // horizontal intent, but only take off for a ball that is already close;
    // otherwise a late bounce or the one-tick input pipeline creates an empty
    // jump and leaves the court undefended.
    const immediateBall =
      view.ball.vy > 0 &&
      view.ball.y >= 96 &&
      view.ball.y <= TUNE.jumpBallY &&
      Math.abs(view.ball.x - view.self.x) <= TUNE.jumpDistance;
    if (!immediateBall) return null;

    for (const point of path) {
      if (point.frame < 3 || point.frame > 10) continue;
      if (point.x < 0 || point.x >= TUNE.GROUND_HALF_WIDTH) continue;
      if (point.y > TUNE.jumpBallY || point.vy <= 0) continue;
      if (Math.abs(point.x - view.self.x) <= TUNE.jumpDistance + 12) {
        return this.action(this.moveTo(view.self.x, point.x), -1, 0);
      }
    }
    return this.action(this.moveTo(view.self.x, view.ball.x), -1, 0);
  }

  powerPlan(view) {
    if (view.self.state !== 1 && view.self.state !== 2) return null;

    const nearBall =
      Math.abs(view.ball.x - view.self.x) <= TUNE.powerDistance &&
      Math.abs(view.ball.y - view.self.y) <= TUNE.powerDistance;
    if (!nearBall || view.ball.y > TUNE.powerMaxY) return null;

    // y=0 creates a fast flat ball when it is safely above the net. For a
    // lower contact, lift it over the net rather than drilling the net post.
    const vertical = view.ball.y < 158 ? 0 : -1;
    return this.action(1, vertical, 1);
  }

  defendTarget(view) {
    // Do not chase an opponent-side landing point. Stay central, but shade
    // toward the likely return lane when the opponent is about to contact.
    const opponentNearBall =
      Math.abs(view.opp.x - view.ball.x) <= TUNE.PLAYER_HALF_LENGTH + 8 &&
      Math.abs(view.opp.y - view.ball.y) <= TUNE.PLAYER_HALF_LENGTH + 8;
    if (!opponentNearBall) return TUNE.homeX;

    const likelyReturn = TUNE.GROUND_WIDTH - view.opp.x;
    return this.clampOwnX((TUNE.homeX * 2 + likelyReturn) / 3);
  }

  plan(view) {
    this.updateRally(view);

    if (view.self.state >= 3) return this.action();

    const power = this.powerPlan(view);
    if (power) return power;

    const forecast = new BallForecast(view.ball);
    const path = forecast.frames(TUNE.forecastFrames);

    if (!view.ownLanding()) {
      return this.action(this.moveTo(view.self.x, this.defendTarget(view)), 0, 0);
    }

    const threat = this.firstOwnThreat(path);
    const jump = this.jumpPlan(view, path);
    if (jump) return jump;

    if (this.shouldDive(view, threat)) {
      return this.action(this.moveTo(view.self.x, threat.x), 0, 1);
    }

    const target = this.receiveTarget(view, threat);
    return this.action(this.moveTo(view.self.x, target), 0, 0);
  }
}

class DittoBot {
  constructor() {
    this.skills = new SkillAdapter();
    this.controller = new TacticalController();
  }

  decide(snapshot) {
    const view = new CourtView(snapshot);
    const plan = this.controller.plan(view);
    const override = this.skills.override(view, plan, this.skills.read(snapshot));
    return view.output(override || plan);
  }
}

const bot = new DittoBot();

function decide(snapshot) {
  return bot.decide(snapshot);
}
