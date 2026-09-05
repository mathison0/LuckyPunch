/**
 * Renders the claw skill (decision D-021): the one-second warning marker over
 * the range that is about to be clawed, and the claw itself.
 *
 * Both are placeholder solid-colour PNGs for now
 * (src/resources/assets/images/skill/). Swapping in real art means replacing
 * the files -- nothing here reads their pixel size, because the drawn size
 * comes from CLAW_WIDTH/CLAW_HEIGHT so the visual can never drift away from
 * the hit range.
 */
'use strict';
import { Sprite } from '@pixi/sprite';
import { Container } from '@pixi/display';
import { ASSETS_PATH } from '../assets_path.js';
import { CLAW_WIDTH, CLAW_HEIGHT } from './claw.js';

/**
 * @constant @type {number}
 * Physics-coordinate to view-coordinate ratio. See view.js and ADR-0019.
 */
const RATIO = ASSETS_PATH.RATIO;

/**
 * @constant @type {number}
 * Top of the drawn claw, in physics coordinates. The claw hits every y inside
 * its x range (see CLAW_HEIGHT), so the column is drawn from the top of the
 * court downwards -- the drawn area and the checked area are the same thing.
 */
const CLAW_TOP_Y = 0;

/**
 * The warning markers and claws for both players, as one container mounted
 * inside GameView so it inherits GameView's visibility and stays below the
 * fade overlay.
 */
export class ClawView {
  /**
   * @param {Object.<string,import('@pixi/loaders').LoaderResource>} resources loader.resources
   */
  constructor(resources) {
    this.container = new Container();

    /** @type {Sprite[]} warning marker of [player1's claw, player2's claw] */
    this.warnings = [];
    /** @type {Sprite[]} claw of [player1's claw, player2's claw] */
    this.claws = [];

    for (let i = 0; i < 2; i++) {
      const warning = makeSprite(resources[ASSETS_PATH.SKILL_CLAW_WARNING]);
      const claw = makeSprite(resources[ASSETS_PATH.SKILL_CLAW]);
      this.container.addChild(warning);
      this.container.addChild(claw);
      this.warnings.push(warning);
      this.claws.push(claw);
    }
  }

  /**
   * @param {(import('./claw.js').ClawState|null)[]} claws tracker.claws
   */
  draw(claws) {
    for (let i = 0; i < 2; i++) {
      const claw = claws[i];
      const isWarning = claw !== null && claw.framesUntilStrike > 0;
      const isStriking = claw !== null && claw.framesUntilStrike === 0;

      this.warnings[i].visible = isWarning;
      this.claws[i].visible = isStriking;
      if (claw !== null) {
        place(this.warnings[i], claw.centerX);
        place(this.claws[i], claw.centerX);
      }
    }
  }
}

/**
 * @param {import('@pixi/loaders').LoaderResource} resource
 * @return {Sprite} hidden sprite sized to the claw range
 */
function makeSprite(resource) {
  const sprite = new Sprite(resource.texture);
  sprite.anchor.x = 0;
  sprite.anchor.y = 0;
  sprite.width = RATIO * CLAW_WIDTH;
  sprite.height = RATIO * CLAW_HEIGHT;
  sprite.visible = false;
  return sprite;
}

/**
 * @param {Sprite} sprite
 * @param {number} centerX centre of the clawed range, physics px
 */
function place(sprite, centerX) {
  sprite.x = RATIO * (centerX - CLAW_WIDTH / 2);
  sprite.y = RATIO * CLAW_TOP_Y;
}
