#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, loadBot } from './sim_engine.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const botFile=path.resolve(process.argv[2]||path.join(HERE,'../PikaPlanner_v2.js'));
const bot=loadBot(botFile);
const e=new Engine(12345);e.resetRound(false);
const neutral={x:0,y:0,hit:0};
let errors=0;
let maxMs=0,totalMs=0,calls=0;
for(let i=0;i<900;i++){
  const side=i%2?'RIGHT':'LEFT';
  const t0=performance.now();
  let a;
  try{a=bot.decide(e.snapshot(side,i));}
  catch(err){console.error('decide exception',err);errors++;a=neutral;}
  const dt=performance.now()-t0;maxMs=Math.max(maxMs,dt);totalMs+=dt;calls++;
  if(!a||![-1,0,1].includes(a.x)||![-1,0,1].includes(a.y)||![0,1].includes(a.hit))errors++;
  e.step({x:(i%3)-1,y:0,hit:0},{x:((i+1)%3)-1,y:0,hit:0});
}
if(errors)throw new Error(`verification failed: ${errors}`);
console.log(JSON.stringify({ok:true,bot:botFile,calls,avgMs:totalMs/calls,maxMs},null,2));
