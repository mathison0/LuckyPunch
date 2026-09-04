#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBot, playTournamentSet } from './sim_engine.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
const v4=path.join(ROOT,'PikaPlanner_v4.js');
const opponents=[
  ['tuned_v1',path.join(ROOT,'reference_opponents/tuned_v1.js')],
  ['v2',path.join(ROOT,'reference_opponents/v2.js')],
  ['v2_1',path.join(ROOT,'reference_opponents/v2_1.js')],
  ['v05',path.join(ROOT,'reference_opponents/v05.js')],
  ['v07',path.join(ROOT,'reference_opponents/v07.js')],
];
const seeds=(process.argv[2]||'1,7920').split(',').map(Number).filter(Number.isFinite);

for (const [name,opp] of opponents){
  for (const side of ['LEFT','RIGHT']){
    let w=0,l=0,d=0,diff=0;
    const rows=[];
    for (const seed of seeds){
      const leftFile=side==='LEFT'?v4:opp;
      const rightFile=side==='LEFT'?opp:v4;
      const r=playTournamentSet({
        leftBot:loadBot(leftFile), rightBot:loadBot(rightFile), seed,
        latencyLeft:1, latencyRight:1, trace:false,
      });
      const v4Score=side==='LEFT'?r.score[0]:r.score[1];
      const oppScore=side==='LEFT'?r.score[1]:r.score[0];
      diff+=v4Score-oppScore;
      const v4Winner=(side==='LEFT'?r.winner===0:r.winner===1);
      if(r.winner===-1)d++; else if(v4Winner)w++; else l++;
      rows.push({seed,score:`${v4Score}-${oppScore}`,frames:r.frames,end:r.endReason});
    }
    console.log(JSON.stringify({opponent:name,v4Side:side,seeds,w,l,d,avgDiff:diff/seeds.length,rows}));
  }
}
