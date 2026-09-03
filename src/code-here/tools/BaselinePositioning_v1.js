'use strict';
function decide(s) {
  var NET = 216, W = 432;
  var towardNet = s.side === 'RIGHT' ? -1 : 1;
  var ownNear = s.side === 'RIGHT' ? NET : 0;
  var ownFar = s.side === 'RIGHT' ? W : NET;
  var standby = (ownNear + ownFar) / 2;
  var own = s.ball.expectedLandingPointX > ownNear && s.ball.expectedLandingPointX < ownFar;
  var target = own ? s.ball.expectedLandingPointX - towardNet * 12 : standby;
  var dx = target - s.self.x;
  var x = Math.abs(dx) > 6 ? (dx > 0 ? 1 : -1) : 0;
  var y = 0;
  if (s.self.state === 0 && Math.abs(s.ball.x - s.self.x) < 32 &&
      Math.abs(s.ball.xVelocity) < 5 && s.ball.y < 150 && s.ball.yVelocity > 0) {
    y = -1;
  }
  return {x:x,y:y,hit:0};
}
