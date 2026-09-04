#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, loadBot } from './sim_engine.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const botFile=path.resolve(process.argv[2]||path.join(HERE,'../PikaPlanner_v2.js'));
const bot=loadBot(botFile);
const neutral={x:0,y:0,hit:0};
let failures=0;
function assert(cond,msg){if(!cond){console.error('FAIL',msg);failures++}else console.log('OK  ',msg)}

// Engine-level event tests: these guard the exact cushion semantics used by
// the simulator/replay tooling.
{
  const e=new Engine(1);e.resetRound(false);e.ball.x=425;e.ball.y=120;e.ball.xVelocity=20;e.ball.yVelocity=4;
  e.step(neutral,neutral);assert(e.lastWorldEvents.includes('WALL_RIGHT'),'right wall bounce event');assert(e.ball.xVelocity<0,'right wall reverses vx');
}
{
  const e=new Engine(2);e.resetRound(false);e.ball.x=216;e.ball.y=185;e.ball.xVelocity=5;e.ball.yVelocity=7;
  e.step(neutral,neutral);assert(e.lastWorldEvents.includes('NET_TOP'),'net-top bounce event');assert(e.ball.yVelocity<0,'net-top reverses downward vy');
}
{
  const e=new Engine(3);e.resetRound(false);e.ball.x=210;e.ball.y=210;e.ball.xVelocity=12;e.ball.yVelocity=2;
  e.step(neutral,neutral);assert(e.lastWorldEvents.includes('NET_SIDE_LEFT'),'net-side bounce event');assert(e.ball.xVelocity<0,'left net side sends ball left');
}

// Bot contract under representative cushion-bound snapshots.
const snaps=[
  {x:18,y:150,vx:-20,vy:8,landing:150},
  {x:420,y:130,vx:20,vy:9,landing:110},
  {x:210,y:182,vx:8,vy:10,landing:95},
  {x:222,y:210,vx:-12,vy:5,landing:145},
];
for(const q of snaps){
  const s={tick:300,side:'LEFT',self:{x:108,y:244,state:0,frameNumber:0,divingDirection:0},opp:{x:324,y:244,state:0,frameNumber:0,divingDirection:0},ball:{x:q.x,y:q.y,xVelocity:q.vx,yVelocity:q.vy,expectedLandingPointX:q.landing,isPowerHit:false},meta:{score:{self:3,opp:3},isPlayer2Serve:false,rallyFrameCount:100},config:{tickFrameGroupSize:3}};
  const a=bot.decide(s);assert(a&&[-1,0,1].includes(a.x)&&[-1,0,1].includes(a.y)&&[0,1].includes(a.hit),`valid action for cushion snapshot ${JSON.stringify(q)}`);
}
if(failures)process.exit(1);console.log(`all cushion regression checks passed for ${botFile}`);
