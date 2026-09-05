/**
 * The "claw" skill (decision D-021).
 *
 * Casting reserves an x-range; one second later a claw appears there and any
 * player whose hitbox overlaps the range is stunned for one second (and
 * teleported to the ground if they were airborne).
 *
 * Like gauge.js this module never touches the original engine files. The stun
 * is expressed purely through fields the engine already owns -- see ADR-0021
 * section 2 for why player.state === 4 (the post-diving "lying down" state)
 * is exactly a stun: it ignores all movement input, counts itself down, and
 * applies to keyboard, bot and built-in AI players alike.
 */
'use strict';
import { isRallyLive } from './rally.js';

/** @constant @type {number} gauge spent per cast */
export const CLAW_COST = 55;

/**
 * Width of the clawed x-range, in the original physics pixels. A player is 64
 * wide and moves 6px per frame, so during the CLAW_WARNING_FRAMES telegraph
 * they can travel up to ~150px: too narrow and dodging is free, too wide and
 * it cannot be dodged at all. First knob to tune after real matches.
 * @constant @type {number}
 */
export const CLAW_WIDTH = 60;

/**
 * The claw covers **every y** inside its x range: there is no vertical dodge,
 * jumping does not help, and a victim caught in the air is dropped to the
 * ground. This constant is the full court height (the original 432x304 canvas)
 * so the drawn column matches the range that is actually checked.
 * @constant @type {number}
 */
export const CLAW_HEIGHT = 304;

/** @constant @type {number} telegraph length; 25 frames = 1.00s at 25fps */
export const CLAW_WARNING_FRAMES = 25;

/**
 * Stun length written into player.lyingDownDurationLeft. The engine decrements
 * it every frame and only leaves the state once it drops below -1, so N burns
 * N+2 frames: 43 -> 45 frames -> exactly 1.80s at 25fps (ADR-0033).
 * @constant @type {number}
 */
export const CLAW_STUN_FRAMES = 43;

/**
 * How long the claw image stays on screen. Purely cosmetic -- the hit is
 * resolved once, on the frame the claw appears.
 * @constant @type {number}
 */
export const CLAW_ACTIVE_FRAMES = 10;

/**
 * How many frames a victim actually cannot move for. CLAW_STUN_FRAMES is what
 * gets written into the engine field; this is what a bot needs to reason with,
 * hence the separate constant (see CLAW_STUN_FRAMES for the +2).
 * @constant @type {number}
 */
export const CLAW_STUN_TOTAL_FRAMES = CLAW_STUN_FRAMES + 2;

/**
 * The tuning numbers above, as the bots see them in their snapshot's
 * `config.claw` (CONTRACTS.md 1.2.1, D-023). They are all still stubs awaiting
 * real matches, so bots read them per tick instead of hardcoding them -- a
 * bot that hardcoded `cost === 50` would keep casting into a silent rejection
 * the day the meeting changes the number.
 * @constant
 */
export const CLAW_SNAPSHOT_CONFIG = Object.freeze({
  cost: CLAW_COST,
  width: CLAW_WIDTH,
  warningFrames: CLAW_WARNING_FRAMES,
  stunFrames: CLAW_STUN_TOTAL_FRAMES,
  activeFrames: CLAW_ACTIVE_FRAMES,
});

/** @constant @type {string} KeyboardEvent.code that casts for player 1 */
export const CLAW_KEY_P1 = 'KeyC';
/** @constant @type {string} KeyboardEvent.code that casts for player 2 */
export const CLAW_KEY_P2 = 'ShiftRight';

// Engine constants (physics.js), mirrored here rather than imported so this
// module keeps its "no engine dependency" shape. Same values bot/botContract.js
// re-exports for the bot protocol.
const PLAYER_HALF_LENGTH = 32;
const PLAYER_TOUCHING_GROUND_Y_COORD = 244;
const GROUND_WIDTH = 432;

/**
 * Bots may aim anywhere on the court, including their own half -- that is a
 * waste, not a foul, so it is not forbidden. Values outside the court are
 * pulled back in rather than rejected (CONTRACTS.md 1.1).
 * @param {number} x
 * @return {number}
 */
function clampToCourt(x) {
  return Math.max(0, Math.min(GROUND_WIDTH, x));
}

/**
 * One player's pending or active claw.
 * @typedef {Object} ClawState
 * @property {number} centerX centre of the clawed range, physics px
 * @property {number} framesUntilStrike counts down to the strike; 0 = struck
 * @property {number} framesLeftActive how long the claw image stays visible
 */

/**
 * Tracks both players' claws by observing the game from the outside.
 *
 * Ticked once per frame from skill/setup.js, after the engine has advanced.
 */
export class ClawTracker {
  /**
   * @param {import('./gauge.js').GaugeTracker} gaugeTracker where casts are paid from
   */
  constructor(gaugeTracker) {
    this.gaugeTracker = gaugeTracker;
    /** @type {(ClawState|null)[]} claw cast by [player1, player2] */
    this.claws = [null, null];
  }

  /** Drop every pending/active claw, e.g. when a rally ends. */
  clear() {
    this.claws = [null, null];
  }

  /**
   * Try to cast for one player. Fails (silently, returning false) if the gauge
   * is short, a claw is already in flight, or the caster is stunned/finished.
   *
   * @param {number} casterIndex 0 for player1, 1 for player2
   * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
   * @param {number|null} [aimX] x to centre the claw on, as a bot picks with
   *   the skillX action field. Omitted (or null) means "aim at the opponent",
   *   which is what the keyboard cast does -- a human has no way to type a
   *   coordinate (CONTRACTS.md 1.1, ADR-0021).
   * @return {boolean} whether the cast happened
   */
  tryCast(casterIndex, pikaVolley, aimX = null) {
    if (!isRallyLive(pikaVolley)) {
      return false;
    }
    if (this.claws[casterIndex] !== null) {
      return false;
    }
    const players = getPlayers(pikaVolley);
    const caster = players[casterIndex];
    // 4 = lying down (i.e. stunned), 5/6 = win/lose motion.
    if (caster.state >= 4) {
      return false;
    }
    if (!this.gaugeTracker.trySpend(casterIndex, CLAW_COST)) {
      return false;
    }

    const target = players[1 - casterIndex];
    this.claws[casterIndex] = {
      centerX: aimX === null ? target.x : clampToCourt(aimX),
      framesUntilStrike: CLAW_WARNING_FRAMES,
      framesLeftActive: 0,
    };
    return true;
  }

  /**
   * Advance both claws by one frame, applying the stun on the frame a claw
   * strikes. Must be called after pikaVolley.gameLoop().
   * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
   */
  observe(pikaVolley) {
    // Claws only live inside a rally, so a claw cast just before a point
    // cannot go off during the next serve. The gauge that paid for it is not
    // refunded (ADR-0021 section 4-4). "Inside a rally" excludes the frames
    // after the ball lands even though the engine is still running there
    // (D-024) -- a claw must not strike once the point is already decided.
    if (!isRallyLive(pikaVolley)) {
      this.clear();
      return;
    }

    const players = getPlayers(pikaVolley);
    for (let i = 0; i < 2; i++) {
      const claw = this.claws[i];
      if (claw === null) {
        continue;
      }
      if (claw.framesUntilStrike > 0) {
        claw.framesUntilStrike -= 1;
        if (claw.framesUntilStrike === 0) {
          claw.framesLeftActive = CLAW_ACTIVE_FRAMES;
          strike(claw, players[1 - i]);
        }
        continue;
      }
      claw.framesLeftActive -= 1;
      if (claw.framesLeftActive <= 0) {
        this.claws[i] = null;
      }
    }
  }
}

/**
 * Resolve one claw against its victim. Called once, on the strike frame.
 * @param {ClawState} claw
 * @param {Object} victim a physics.js Player
 */
function strike(claw, victim) {
  if (!isWithinClaw(claw, victim.x)) {
    return;
  }
  // Airborne victims are dropped to the ground first. This is both what the
  // skill spec asks for and what keeps the engine consistent: the lying-down
  // branch returns before gravity runs, so a victim stunned mid-air would
  // otherwise hang there (ADR-0021 section 2).
  victim.y = PLAYER_TOUCHING_GROUND_Y_COORD;
  victim.yVelocity = 0;
  victim.state = 4;
  victim.frameNumber = 0;
  victim.lyingDownDurationLeft = CLAW_STUN_FRAMES;
}

/**
 * Does a player standing at playerX overlap the clawed range?
 * @param {ClawState} claw
 * @param {number} playerX
 * @return {boolean}
 */
export function isWithinClaw(claw, playerX) {
  const half = CLAW_WIDTH / 2;
  return (
    playerX + PLAYER_HALF_LENGTH >= claw.centerX - half &&
    playerX - PLAYER_HALF_LENGTH <= claw.centerX + half
  );
}

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @return {Object[]} [player1, player2]
 */
function getPlayers(pikaVolley) {
  return [pikaVolley.physics.player1, pikaVolley.physics.player2];
}
