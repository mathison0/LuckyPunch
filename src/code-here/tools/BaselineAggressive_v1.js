'use strict';
function decide(s) {
  var flip = s.side === 'RIGHT';
  var sx = flip ? 432 - s.self.x : s.self.x;
  var bx = flip ? 432 - s.ball.x : s.ball.x;
  var lx = flip ? 432 - s.ball.expectedLandingPointX : s.ball.expectedLandingPointX;
  var vx = flip ? -s.ball.xVelocity : s.ball.xVelocity;
  var x = 0, y = 0, hit = 0;
  var target = lx < 216 ? Math.max(32, Math.min(184, lx - 20)) : 112;
  if (Math.abs(target - sx) > 5) x = target > sx ? 1 : -1;
  if (s.self.state === 0 && lx < 216 && s.ball.yVelocity > 0 && s.ball.y < 190 &&
      Math.abs(bx - sx) < 70) y = -1;
  if ((s.self.state === 1 || s.self.state === 2) && Math.abs(bx - sx) < 52 &&
      Math.abs(s.ball.y - s.self.y) < 60) {
    hit = s.self.state === 1 ? 1 : 0;
    x = bx > sx ? 1 : bx < sx ? -1 : 1;
    y = (216 - bx) < 85 ? 1 : -1;
  }
  if (flip) x = -x;
  return {x:x,y:y,hit:hit};
}
