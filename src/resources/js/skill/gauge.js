/**
 * Gauge -- the resource that skills will be bought with (decision D-020).
 *
 * This module deliberately contains no rendering and no engine mutation: it is
 * a pure observer that watches the physics engine's existing per-contact flag
 * and keeps a number per player. See gaugeView.js for drawing and setup.js for
 * the wiring.
 */
'use strict';
import { isRallyLive } from './rally.js';

/** @constant @type {number} */
export const GAUGE_MIN = 0;
/** @constant @type {number} */
export const GAUGE_MAX = 100;
/** @constant @type {number} gauge both players start a match with */
export const GAUGE_INITIAL = 0;

/**
 * Gained when receiving a ball that came from the opponent, i.e. the first
 * touch after the other player touched it.
 * @constant @type {number}
 */
export const GAUGE_ON_RECEIVE = 15;

/**
 * Applied when touching the ball again on one's own side instead of sending it
 * over. Only kicks in from the Nth same-side touch (see
 * GAUGE_EXTRA_TOUCH_STARTS_AT); touches before that count as 0. Under the
 * current values (starts at 3, penalty -5) a two-touch return (receive + set)
 * is +15, a three-touch is +10, a four-touch is +5. Five is where the touch
 * limit ends the rally on its own (rules/touchLimit.js).
 * @constant @type {number}
 */
export const GAUGE_ON_EXTRA_TOUCH = -5;

/**
 * First same-side touch to which GAUGE_ON_EXTRA_TOUCH applies, counting the
 * receive as #1. 3 means "the receive and the touch after it are free; only
 * the third same-side touch and beyond are penalised" (ADR-0033).
 * @constant @type {number}
 */
export const GAUGE_EXTRA_TOUCH_STARTS_AT = 3;

/**
 * Applied when the touch was a successful power hit (the smash-in-air, i.e.
 * physics.js player.state === 2 at contact -- what the engine expresses as
 * ball.isPowerHit becoming true). Stacks on top of the per-touch delta above,
 * so a receive + smash return is +15 - 10 = +5 net. A dive contact (state 3)
 * is not a power hit and gets no penalty (ADR-0033).
 * @constant @type {number}
 */
export const GAUGE_ON_POWER_HIT = -10;

/**
 * Applied to the first contact of a rally (the serve). A serve is not a
 * receive -- nobody had to read and reach a ball to make it -- so it earns
 * nothing. Tuning stub like the rest of this file.
 * @constant @type {number}
 */
export const GAUGE_ON_SERVE = 0;

/**
 * The gauge rules as the bots see them in their snapshot's `config.gauge`
 * (CONTRACTS.md 1.2.1, D-023). Exposed rather than left for bots to hardcode
 * for the same reason as CLAW_SNAPSHOT_CONFIG: these are tuning stubs, and a
 * bot planning "one clean return and I can afford a claw" must plan against
 * the numbers actually in force.
 * @constant
 */
export const GAUGE_SNAPSHOT_CONFIG = Object.freeze({
  min: GAUGE_MIN,
  max: GAUGE_MAX,
  onReceive: GAUGE_ON_RECEIVE,
  onExtraTouch: GAUGE_ON_EXTRA_TOUCH,
  extraTouchStartsAt: GAUGE_EXTRA_TOUCH_STARTS_AT,
  onPowerHit: GAUGE_ON_POWER_HIT,
  onServe: GAUGE_ON_SERVE,
});

/**
 * Tracks a gauge per player by observing the physics engine from the outside.
 *
 * The engine sets player.isCollisionWithBallHappened to true on contact and
 * back to false once the ball leaves the player's box (physics.js:345-360), so
 * a false -> true transition is exactly one "hit the ball" event. Sampling
 * that every tick means the whole feature needs no change to physics.js --
 * same approach bot/testSetup.js already uses for keyboardArray.
 */
export class GaugeTracker {
  constructor() {
    /** @type {number[]} gauge of [player1, player2] */
    this.gauges = [GAUGE_INITIAL, GAUGE_INITIAL];

    /**
     * Who touched the ball last in the current rally, or null if nobody has
     * yet. null is what makes the next contact count as a serve, so it is
     * reset on every rally boundary rather than only at match start.
     * @type {number|null} 0, 1 or null
     */
    this.lastToucherIndex = null;

    /**
     * How many consecutive same-side touches the current toucher has made in
     * this possession. 1 for the receive (or serve), 2 for the touch after
     * it, and so on. Compared against GAUGE_EXTRA_TOUCH_STARTS_AT to decide
     * whether the extra-touch penalty applies (ADR-0033).
     * @type {number}
     */
    this.sameSideTouchCount = 0;

    /** @type {boolean[]} previous tick's collision flags, for edge detection */
    this.previousCollisionFlags = [false, false];

    /** @type {boolean} whether the previous tick was inside startOfNewGame */
    this.wasStartingNewGame = false;
  }

  /**
   * Reset both gauges. Called when a new match starts (D-020: gauge survives
   * rallies but not matches).
   */
  resetForNewGame() {
    this.gauges = [GAUGE_INITIAL, GAUGE_INITIAL];
    this.lastToucherIndex = null;
    this.sameSideTouchCount = 0;
    this.previousCollisionFlags = [false, false];
  }

  /**
   * Gauge of one player, for rendering and (later) skill affordability checks.
   * @param {number} playerIndex 0 or 1
   * @return {number} in [GAUGE_MIN, GAUGE_MAX]
   */
  getGauge(playerIndex) {
    return this.gauges[playerIndex];
  }

  /**
   * Pay for a skill. All-or-nothing: a player who cannot afford the cost
   * spends nothing, so callers can use the return value as the "can I cast?"
   * check without asking twice.
   * @param {number} playerIndex 0 or 1
   * @param {number} amount gauge to spend, e.g. CLAW_COST
   * @return {boolean} whether the gauge was actually spent
   */
  trySpend(playerIndex, amount) {
    if (this.gauges[playerIndex] < amount) {
      return false;
    }
    this.gauges[playerIndex] = clamp(this.gauges[playerIndex] - amount);
    return true;
  }

  /**
   * Apply one ball contact by the given player.
   * @param {number} playerIndex 0 or 1
   * @param {boolean} isPowerHit whether this contact was a successful power
   *   hit (the engine's ball.isPowerHit at the moment of collision, i.e.
   *   player.state === 2). A dive contact is not a power hit.
   */
  registerTouch(playerIndex, isPowerHit) {
    let delta;
    if (this.lastToucherIndex === null) {
      delta = GAUGE_ON_SERVE;
      this.sameSideTouchCount = 1;
    } else if (this.lastToucherIndex === playerIndex) {
      this.sameSideTouchCount += 1;
      // ADR-0033: the receive and the touch after it are free; only the
      // Nth same-side touch and beyond pay the extra-touch penalty.
      delta =
        this.sameSideTouchCount >= GAUGE_EXTRA_TOUCH_STARTS_AT
          ? GAUGE_ON_EXTRA_TOUCH
          : 0;
    } else {
      delta = GAUGE_ON_RECEIVE;
      this.sameSideTouchCount = 1;
    }
    if (isPowerHit) {
      delta += GAUGE_ON_POWER_HIT;
    }
    this.gauges[playerIndex] = clamp(this.gauges[playerIndex] + delta);
    this.lastToucherIndex = playerIndex;
  }

  /**
   * Observe one tick of the game. Must be called after pikaVolley.gameLoop()
   * so that the flags reflect the frame that was just simulated.
   * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
   */
  observe(pikaVolley) {
    // A match starts in startOfNewGame, which is also where scores are zeroed
    // (pikavolley.js:287-300). Reset on the transition into it, not on every
    // frame of it, since that state lasts 71 frames.
    const isStartingNewGame = pikaVolley.state === pikaVolley.startOfNewGame;
    if (isStartingNewGame && !this.wasStartingNewGame) {
      this.resetForNewGame();
    }
    this.wasStartingNewGame = isStartingNewGame;

    // Only contacts inside a live rally charge the gauge. Note this is not the
    // same as "the engine is running": it keeps running for ~1.2s after the
    // ball lands and through the game-end message, and hits in those windows
    // used to charge the gauge (D-024). Once the rally is over the next
    // contact is a serve, so the last-toucher memory is cleared here.
    if (!isRallyLive(pikaVolley)) {
      this.lastToucherIndex = null;
      this.sameSideTouchCount = 0;
      this.previousCollisionFlags = [false, false];
      return;
    }

    const players = [pikaVolley.physics.player1, pikaVolley.physics.player2];
    const ball = pikaVolley.physics.ball;
    for (let i = 0; i < 2; i++) {
      const isColliding = players[i].isCollisionWithBallHappened;
      if (isColliding && !this.previousCollisionFlags[i]) {
        // ball.isPowerHit is written by processCollisionBetweenBallAndPlayer
        // on this same frame -- it reflects whichever contact the engine
        // processed last. Since the physics loop only enters that branch on
        // a false -> true edge (same edge we detect here), reading it right
        // after gameLoop() gives the correct answer for this contact in the
        // usual one-player-per-tick case. Two simultaneous edges (both P1
        // and P2 collide this frame) can race; ADR-0033 documents that
        // fallback if it ever shows up in measurements.
        this.registerTouch(i, ball.isPowerHit === true);
      }
      this.previousCollisionFlags[i] = isColliding;
    }
  }
}

/**
 * @param {number} value
 * @return {number} value clamped into [GAUGE_MIN, GAUGE_MAX]
 */
function clamp(value) {
  return Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, value));
}
