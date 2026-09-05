/**
 * Renders the two gauge bars (decision D-020).
 *
 * Two things this file deliberately does NOT do:
 *
 * 1. It does not use @pixi/graphics -- the project only depends on the canvas
 *    renderer bundles and does not ship a Graphics package. Solid rectangles
 *    are drawn by stretching a 1x1 texture, the same trick FadeInOut uses for
 *    its full-screen black overlay (view.js:669-681).
 * 2. It does not hardcode on-screen pixels. All geometry below is written in
 *    the original 432x304 physics coordinate space and multiplied by RATIO at
 *    draw time, exactly like view.js does for every other sprite (ADR-0019).
 */
'use strict';
import { Sprite } from '@pixi/sprite';
import { Container } from '@pixi/display';
import { Texture } from '@pixi/core';
import { ASSETS_PATH } from '../assets_path.js';
import { GAUGE_MAX } from './gauge.js';

/**
 * Bar colours, as tints on a 1x1 texture.
 *
 * These are deliberately NOT taken from the sprite sheet. The first
 * implementation stretched the sheet's objects/ground_red and
 * objects/ground_yellow tiles, but the Pengsoo asset replacement recoloured
 * both of them to nearly the same pale court colour, which made the filled and
 * empty parts of the bar indistinguishable (measured on canvas: both read
 * rgb(219,230,149)). Tints keep the bar readable no matter what a future asset
 * swap does to the court palette.
 * @constant
 */
const COLOR = {
  border: 0x000000,
  track: 0x4a3b2a, // dark brown, reads as "empty" against the sky
  fill: 0xf5d02c, // the original gauge yellow
};

/**
 * @constant @type {number}
 * Physics-coordinate to view-coordinate ratio. See view.js and ADR-0019.
 */
const RATIO = ASSETS_PATH.RATIO;

/**
 * Bar geometry, in physics coordinates. Width matches a score board (two
 * 32x32 numbers) and the bars sit right under them, so the gauge reads as
 * belonging to that player's score. Score boards are at y = 10 and are 32px
 * tall (view.js:417-420).
 * @constant
 */
const BAR = {
  width: 64,
  height: 6,
  y: 46,
  leftX: 14, // same inset as scoreBoards[0]
  rightX: 432 - 32 - 32 - 14, // same inset as scoreBoards[1]
  borderThickness: 1,
};

/**
 * The two gauge bars, as one container to be mounted inside GameView so that
 * it inherits GameView's visibility and stays underneath the fade overlay.
 */
export class GaugeView {
  constructor() {
    this.container = new Container();

    /** @type {Sprite[]} filled portion of [player1, player2] bar */
    this.fills = [];

    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? BAR.leftX : BAR.rightX;

      const border = makeStretchedSprite(COLOR.border);
      border.x = RATIO * (x - BAR.borderThickness);
      border.y = RATIO * (BAR.y - BAR.borderThickness);
      border.width = RATIO * (BAR.width + 2 * BAR.borderThickness);
      border.height = RATIO * (BAR.height + 2 * BAR.borderThickness);

      const track = makeStretchedSprite(COLOR.track);
      track.x = RATIO * x;
      track.y = RATIO * BAR.y;
      track.width = RATIO * BAR.width;
      track.height = RATIO * BAR.height;

      const fill = makeStretchedSprite(COLOR.fill);
      fill.y = RATIO * BAR.y;
      fill.height = RATIO * BAR.height;
      // Player 2's bar grows right-to-left so that both bars fill outward from
      // the net, mirroring the two sides of the court.
      fill.anchor.x = i === 0 ? 0 : 1;
      fill.x = i === 0 ? RATIO * x : RATIO * (x + BAR.width);

      this.container.addChild(border);
      this.container.addChild(track);
      this.container.addChild(fill);
      this.fills.push(fill);
    }
  }

  /**
   * @param {number[]} gauges gauge of [player1, player2]
   */
  draw(gauges) {
    for (let i = 0; i < 2; i++) {
      const ratio = gauges[i] / GAUGE_MAX;
      // A zero-width sprite still renders a hairline in the canvas renderer,
      // so hide the fill entirely when the gauge is empty.
      this.fills[i].visible = ratio > 0;
      this.fills[i].width = RATIO * BAR.width * ratio;
    }
  }
}

/**
 * A solid rectangle of the given colour, top-left anchored and ready to be
 * stretched to any size. Uses Pixi's built-in 1x1 white texture with a tint,
 * the same technique FadeInOut uses (view.js:669-681) -- note the warning
 * there: set .width/.height, never .scale, on these sprites.
 * @param {number} tint 0xRRGGBB
 * @return {Sprite}
 */
function makeStretchedSprite(tint) {
  const sprite = new Sprite(Texture.WHITE);
  sprite.tint = tint;
  sprite.anchor.x = 0;
  sprite.anchor.y = 0;
  return sprite;
}
