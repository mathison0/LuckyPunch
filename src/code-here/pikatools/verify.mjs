#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBot, Engine, runSeries } from './sim_engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const botFile = path.resolve(process.argv[2] || path.join(HERE, '../PikaPlanner_tuned_v1.js'));
const bot = loadBot(botFile);
const e = new Engine(123); e.resetRound(false);
let bad = 0;
for (let i=0;i<1500;i++) {
  const side = i % 2 ? 'RIGHT' : 'LEFT';
  let a;
  try { a = bot.decide(e.snapshot(side, i)); } catch { bad++; a={x:0,y:0,hit:0}; }
  if (!a || ![-1,0,1].includes(a.x) || ![-1,0,1].includes(a.y) || ![0,1].includes(a.hit)) bad++;
  e.step({x:(i%3)-1,y:0,hit:0},{x:((i+1)%3)-1,y:0,hit:0});
}
if (bad) throw new Error(`contract/smoke failures: ${bad}`);

const pos = path.join(HERE, 'BaselinePositioning_v1.js');
const agg = path.join(HERE, 'BaselineAggressive_v1.js');
const r1 = runSeries({leftFile:botFile,rightFile:pos,matches:6,seed:77,latencySet:[1,2,3]});
const r2 = runSeries({leftFile:botFile,rightFile:agg,matches:6,seed:99,latencySet:[1,2,3]});
console.log(JSON.stringify({ok:true,botFile,smokeCalls:1500,vsPositioning:r1,vsAggressive:r2},null,2));
