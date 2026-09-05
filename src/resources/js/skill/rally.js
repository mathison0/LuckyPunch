/**
 * One shared answer to "is a rally actually being played right now?" (D-024).
 *
 * Every skill-layer tracker needs this, and the obvious test --
 * `pikaVolley.state === pikaVolley.round` -- is wrong. `round()` keeps running
 * the engine after the ball has landed: touching the ground sets
 * `roundEnded = true` and starts a 6-frame slow motion
 * (pikavolley.js:396-398), and the state only becomes `afterEndOfRound` once
 * those frames are spent (pikavolley.js:403-405). At slowMotionFPS = 5 that is
 * about 1.2 seconds of wall clock in which `runEngineForNextFrame` still runs
 * (pikavolley.js:345) and ball contacts still register.
 *
 * The same call sits *above* the `gameEnded` early return, so the engine also
 * keeps stepping while the win/lose message is on screen.
 *
 * Both windows are "the rally is over but state is still round", which is
 * exactly what this module exists to exclude.
 */
'use strict';

/**
 * Whether the engine is simulating a live rally, i.e. contacts and skills
 * should count.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @return {boolean}
 */
export function isRallyLive(pikaVolley) {
  return (
    pikaVolley.state === pikaVolley.round &&
    pikaVolley.roundEnded === false &&
    pikaVolley.gameEnded === false
  );
}
