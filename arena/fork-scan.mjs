// 포크 스캔 — "상대가 코트 어디에 서 있어도 최소 한 옵션은 못 받는" 접촉이
// 존재하는지 전수 검사한다.
//
// v8 실험(다단 운반 후 네트 앞 내리꽂기)을 기각한 근거 도구다. 현재 물리에선
// 포크 성립 지점이 x=242, y=110 (여유 +4px) 단 한 점뿐이다.
// **대회 당일 스킬로 물리가 바뀌면 이 스캔을 다시 돌려볼 것** — 스매시 속도나
// 네트 판정이 달라지면 창이 열릴 수 있고, 열리면 세팅 전략이 되살아난다.
//
// 사용법: node fork-scan.mjs [OPP_REACT=4]
//   (sync-engine.sh 로 physics.mjs 를 먼저 갱신해 둘 것)

const GROUND_WIDTH = 432;
const NET_X = 216;
const BALL_GROUND_Y = 252;
const PLAYER_HALF = 32;
const NET_HALF_W = 25;
const NET_TOP_TOP = 176;
const NET_TOP_BOTTOM = 192;
const PLAYER_SPEED = 6;
const SIM_LIMIT = 200;
const OPP_REACT = Number(process.argv[2] || 4);

function stepBall(b) {
  const futureX = b.x + b.vx;
  if (futureX < 0 || futureX > GROUND_WIDTH) b.vx = -b.vx;
  if (b.y + b.vy < 0) b.vy = 1;
  if (Math.abs(b.x - NET_X) < NET_HALF_W && b.y > NET_TOP_TOP) {
    if (b.y <= NET_TOP_BOTTOM) {
      if (b.vy > 0) b.vy = -b.vy;
    } else {
      b.vx = b.x < NET_X ? -Math.abs(b.vx) : Math.abs(b.vx);
    }
  }
  const futureY = b.y + b.vy;
  if (futureY > BALL_GROUND_Y) { b.y = BALL_GROUND_Y; return true; }
  b.y = futureY; b.x += b.vx; b.vy += 1;
  return false;
}

function powerHitVelocity(ballX, ballVy, xMag, yDir) {
  return {
    vx: ballX < NET_X ? (xMag + 1) * 10 : -(xMag + 1) * 10,
    vy: Math.max(Math.abs(ballVy), 15) * yDir * 2,
  };
}

/** 접촉 (x, y, vy)에서의 포크 마진. 양수 = 최적 수비수도 못 받는 보장 킬. */
export function forkMargin(contactX, contactY, contactVy, attackerIsLeft) {
  const opts = [];
  for (let xm = 0; xm <= 1; xm++) {
    for (let yd = -1; yd <= 1; yd++) {
      const v = powerHitVelocity(contactX, contactVy, xm, yd);
      const b = { x: contactX, y: contactY, vx: v.vx, vy: v.vy };
      let fl = -1;
      for (let t = 1; t <= SIM_LIMIT; t++) if (stepBall(b)) { fl = t; break; }
      if (fl > 0 && (attackerIsLeft ? b.x > NET_X + 6 : b.x < NET_X - 6)) {
        opts.push({ landX: b.x, flight: fl });
      }
    }
  }
  if (opts.length === 0) return -1;
  const lo = attackerIsLeft ? NET_X + PLAYER_HALF : PLAYER_HALF;
  const hi = attackerIsLeft ? GROUND_WIDTH - PLAYER_HALF : NET_X - PLAYER_HALF;
  let fork = 1e9;
  for (let p = lo; p <= hi; p += 8) {
    let bestEscape = -1e9;
    for (const o of opts) {
      const reach = PLAYER_SPEED * Math.max(0, o.flight - OPP_REACT);
      const m = Math.abs(o.landX - p) - reach - PLAYER_HALF;
      if (m > bestEscape) bestEscape = m;
    }
    if (bestEscape < fork) fork = bestEscape;
  }
  return fork;
}

// ── 전수 스캔: RIGHT 공격수 기준 (좌우 대칭이므로 한쪽이면 충분) ──
if (process.argv[1] && process.argv[1].endsWith('fork-scan.mjs')) {
  console.log(`포크 스캔 (OPP_REACT=${OPP_REACT}) — 양수 마진 = 보장 킬 접촉점`);
  let found = 0;
  let best = null;
  for (let y = 76; y <= 210; y += 4) {
    for (let x = NET_X + NET_HALF_W + 1; x <= GROUND_WIDTH - PLAYER_HALF; x += 4) {
      for (const vy of [5, 10, 15]) {
        const fm = forkMargin(x, y, vy, false);
        if (fm > 0) {
          found++;
          if (best === null || fm > best.fm) best = { x, y, vy, fm };
          if (found <= 12) console.log(`  x=${x} y=${y} vy=${vy} → +${fm.toFixed(0)}px`);
        }
      }
    }
  }
  console.log(found === 0
    ? '보장 킬 접촉점 없음 — 세팅 전략은 현 물리에서 성립하지 않는다.'
    : `총 ${found}개 지점. 최고: x=${best.x} y=${best.y} (+${best.fm.toFixed(0)}px)` +
      (best.fm < 20 ? ' — 이동 단위 18px/tick보다 작으면 실전 도달 불가에 유의.' : ' — 세팅 전략 재검토 가치 있음!'));
}
