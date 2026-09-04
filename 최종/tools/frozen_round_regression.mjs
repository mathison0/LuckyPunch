#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, loadBot } from './sim_engine.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const botFile=path.resolve(process.argv[2]||path.join(HERE,'../PikaPlanner_v4.js'));
let bad=0, checked=0;
for(const side of ['LEFT','RIGHT']){
  for(const serverP2 of [false,true]){
    const bot=loadBot(botFile);
    const e=new Engine(123); e.resetRound(serverP2);
    for(let f=0;f<40;f++){
      e.frame=f;
      if((f+1)%3!==0) continue;
      const a=bot.decide(e.snapshot(side,f));
      checked++;
      if(!a || a.y!==0 || a.hit!==0 || ![-1,0,1].includes(a.x)){
        bad++; console.error('bad frozen action',{side,serverP2,frame:f+1,a});
      }
    }
  }
}
if(bad) throw new Error(`frozen-round regression failed: ${bad}/${checked}`);
console.log(JSON.stringify({pass:true,checked,bot:botFile}));
