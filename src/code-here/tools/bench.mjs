#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBot, Engine } from './sim_engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const botFile = path.resolve(process.argv[2] || path.join(HERE, '../PikaPlanner_tuned_v1.js'));
const bot = loadBot(botFile);
const e = new Engine(1); e.resetRound(false);
const N = Number(process.argv[3] || 20000);
const snaps=[];
for(let i=0;i<300;i++){
  snaps.push(e.snapshot(i%2?'RIGHT':'LEFT',i));
  e.step({x:(i%3)-1,y:0,hit:0},{x:((i+1)%3)-1,y:0,hit:0});
}
const t0=performance.now();
let bad=0;
for(let i=0;i<N;i++){
  const a=bot.decide(snaps[i%snaps.length]);
  if(!a||![-1,0,1].includes(a.x)||![-1,0,1].includes(a.y)||![0,1].includes(a.hit))bad++;
}
const ms=performance.now()-t0;
console.log(JSON.stringify({bot:botFile,calls:N,totalMs:ms,avgMs:ms/N,badActions:bad},null,2));
