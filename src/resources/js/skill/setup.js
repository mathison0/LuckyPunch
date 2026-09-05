/**
 * Wires the skill system (gauge D-020, claw D-021) into the running game.
 *
 * Nothing here modifies the original engine files: the trackers observe
 * physics state that already exists, and the views are mounted as extra
 * children of GameView's container. Same assembly-layer approach as
 * bot/testSetup.js.
 *
 * Construction and observation are deliberately two steps (D-023 section 6).
 * The trackers must exist *before* bot/testSetup.js builds its PikaBotInputs,
 * because those read gauge/claw state for every snapshot they send; but the
 * per-frame observation must be registered *after* start(), so the callback
 * runs once pikaVolley.gameLoop() has already advanced the frame. main.js
 * therefore calls setUpSkills() early and startObserving() late.
 */
'use strict';
import { GaugeTracker, GAUGE_SNAPSHOT_CONFIG } from './gauge.js';
import { GaugeView } from './gaugeView.js';
import {
  ClawTracker,
  CLAW_KEY_P1,
  CLAW_KEY_P2,
  CLAW_SNAPSHOT_CONFIG,
} from './claw.js';
import { ClawView } from './clawView.js';

/**
 * Static half of what bots see: the tuning numbers, which never change during
 * a session. Frozen and shared so building a snapshot doesn't re-allocate it
 * every tick.
 * @constant
 */
const SKILL_SNAPSHOT_CONFIG = Object.freeze({
  gauge: GAUGE_SNAPSHOT_CONFIG,
  claw: CLAW_SNAPSHOT_CONFIG,
});

/**
 * @typedef {Object} SkillSystem
 * @property {GaugeTracker} gaugeTracker
 * @property {ClawTracker} clawTracker
 * @property {function(): {gauges: number[], claws: (import('./claw.js').ClawState|null)[], config: Object}} getSkillState
 *   live skill state for the bot snapshot builder, by player index
 *   (CONTRACTS.md 1.2.1)
 * @property {function(import('@pixi/ticker').Ticker): void} startObserving
 */

/**
 * Build the skill trackers and views and mount them. Does not touch the
 * ticker -- call startObserving() for that, after start().
 *
 * The cast key is read with a plain keydown listener instead of extending
 * PikaKeyboard: skill input lives outside the engine's three-field protocol
 * (xDirection/yDirection/powerHit), and putting it in the keyboard class would
 * leak it into the bot and built-in-AI slots that share keyboardArray.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {Object.<string,import('@pixi/loaders').LoaderResource>} resources loader.resources
 * @return {SkillSystem}
 */
export function setUpSkills(pikaVolley, resources) {
  const gaugeTracker = new GaugeTracker();
  const clawTracker = new ClawTracker(gaugeTracker);
  const gaugeView = new GaugeView();
  const clawView = new ClawView(resources);

  // Mounting inside GameView rather than on the stage means the bars and claws
  // follow GameView's visibility (hidden during intro/menu) and stay below the
  // fade overlay, which pikavolley.js adds to the stage after GameView.
  pikaVolley.view.game.container.addChild(gaugeView.container);
  pikaVolley.view.game.container.addChild(clawView.container);

  window.addEventListener('keydown', (event) => {
    // event.repeat filters the OS key-repeat storm while a key is held; a cast
    // should cost gauge once per press. (A held key still cannot double-cast,
    // since tryCast refuses while a claw is in flight -- this is just to avoid
    // spending the gauge again the instant the previous claw resolves.)
    if (event.repeat) {
      return;
    }
    if (event.code === CLAW_KEY_P1) {
      clawTracker.tryCast(0, pikaVolley);
    } else if (event.code === CLAW_KEY_P2) {
      clawTracker.tryCast(1, pikaVolley);
    }
  });

  // Same reason bot/testSetup.js exposes window.__pikaVolley: with no test
  // suite, VERIFY.md's browser smoke test is the only check on this layer, and
  // gauge/claw state is otherwise invisible to an automation script (the claw
  // sprite is deliberately translucent and the stun looks like a dive).
  window.__pikaSkills = { gaugeTracker, clawTracker };

  return {
    gaugeTracker,
    clawTracker,
    getSkillState: () => ({
      gauges: gaugeTracker.gauges,
      claws: clawTracker.claws,
      config: SKILL_SNAPSHOT_CONFIG,
    }),
    startObserving: (ticker) => {
      // Registered after main.js's own ticker callback, so pikaVolley
      // .gameLoop() has already advanced the frame this tick and the physics
      // flags the trackers read are current.
      ticker.add(() => {
        gaugeTracker.observe(pikaVolley);
        gaugeView.draw(gaugeTracker.gauges);
        castForBots(pikaVolley, clawTracker);
        clawTracker.observe(pikaVolley);
        clawView.draw(clawTracker.claws);
      });
    },
  };
}

/**
 * Let bot-controlled sides cast, using the x their latest response asked for.
 *
 * Reading it off keyboardArray keeps the skill layer decoupled from how a side
 * is being driven: a keyboard or the built-in AI simply has no consumeSkillX,
 * so nothing happens for them. Draining is what limits a bot to one cast per
 * response rather than one per frame (CONTRACTS.md 1.1).
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {ClawTracker} tracker
 */
function castForBots(pikaVolley, tracker) {
  for (let i = 0; i < 2; i++) {
    const input = pikaVolley.keyboardArray[i];
    if (!input || typeof input.consumeSkillX !== 'function') {
      continue;
    }
    const skillX = input.consumeSkillX();
    if (skillX !== null) {
      tracker.tryCast(i, pikaVolley, skillX);
    }
  }
}
