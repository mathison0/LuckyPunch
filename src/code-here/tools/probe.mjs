#!/usr/bin/env node
// Small physics notebook for tournament-day experiments.  It intentionally
// focuses on disclosed quantities rather than rendering the game.
const GROUND = 252, W = 432, NET = 216, NH = 25, NT = 176, NB = 192;

function step(b) {
  const fx = b.x + b.vx;
  if (fx < 0 || fx > W) b.vx = -b.vx;
  if (b.y + b.vy < 0) b.vy = 1;
  if (Math.abs(b.x - NET) < NH && b.y > NT) {
    if (b.y <= NB) { if (b.vy > 0) b.vy = -b.vy; }
    else b.vx = b.x < NET ? -Math.abs(b.vx) : Math.abs(b.vx);
  }
  if (b.y + b.vy > GROUND) { b.y = GROUND; return true; }
  b.y += b.vy; b.x += b.vx; b.vy += 1; return false;
}
function shot(x, y, vyBefore, fast, yDir, side='LEFT') {
  const b = {x,y,vx: side==='LEFT' ? (fast?20:10) : -(fast?20:10),vy:Math.abs(vyBefore)*yDir*2};
  const rows=[];
  for(let t=1;t<=100;t++){const g=step(b);rows.push({t,x:b.x,y:b.y,vx:b.vx,vy:b.vy});if(g)break;}
  return rows;
}

const args = Object.fromEntries(process.argv.slice(2).map(x=>x.split('=')));
const x = Number(args.x ?? 165), y = Number(args.y ?? 130), vy = Number(args.vy ?? 10);
console.log(`contact ball: x=${x}, y=${y}, |vy|=${Math.abs(vy)}`);
for (const fast of [false,true]) {
  for (const yd of [-1,0,1]) {
    const tr=shot(x,y,vy,fast,yd,'LEFT'); const last=tr[tr.length-1];
    console.log(`${fast?'FAST':'SLOW'} ${yd===-1?'UP':yd===0?'FLAT':'DOWN'} -> landing=${last.x}, frames=${last.t}`);
  }
}
console.log('\nUsage: node probe.mjs x=165 y=130 vy=10');
