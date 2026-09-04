#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBot, playTournamentSet } from './sim_engine.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
const [,,oppName='v05',side='LEFT',seedArg='1']=process.argv;
const opp=path.join(ROOT,'reference_opponents',oppName+'.js');
const v4=path.join(ROOT,'PikaPlanner_v4.js');
const seed=Number(seedArg);
const r=playTournamentSet({leftBot:loadBot(side==='LEFT'?v4:opp),rightBot:loadBot(side==='LEFT'?opp:v4),seed,latencyLeft:1,latencyRight:1,trace:true});
const score=side==='LEFT'?r.score:[r.score[1],r.score[0]];
console.log(JSON.stringify({oppName,side,seed,v4Score:score[0],oppScore:score[1],frames:r.frames,endReason:r.endReason,points:r.points},null,2));
