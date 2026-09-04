#!/usr/bin/env node
import fs from 'node:fs'; import vm from 'node:vm';
const file=process.argv[2] || './PikaPlanner_v4.js'; const src=fs.readFileSync(file,'utf8');
function load(){const ctx={console};vm.createContext(ctx);vm.runInContext(src,ctx);return ctx;}
function reset(ctx){vm.runInContext("MEM.decisions=0;MEM.prev=null;MEM.lastAction={x:0,y:0,hit:0};MEM.inferredOppXDir=0;MEM.ownTouchEstimate=0;MEM.oppTouchEstimate=0;MEM.selfSetUsed=false;MEM.worldFlip=false;MEM.selfSetPendingTick=null;MEM.lastScoreSelf=0;MEM.lastScoreOpp=0;MEM.lastBall=null;",ctx)}
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
const R=rng(20260904),L=load(),RR=load();
function mirror(s){return {tick:s.tick,side:'RIGHT',self:{...s.self,x:432-s.self.x,divingDirection:-s.self.divingDirection},opp:{...s.opp,x:432-s.opp.x,divingDirection:-s.opp.divingDirection},ball:{...s.ball,x:432-s.ball.x,xVelocity:-s.ball.xVelocity,expectedLandingPointX:432-s.ball.expectedLandingPointX},meta:{...s.meta,score:{...s.meta.score},isPlayer2Serve:!s.meta.isPlayer2Serve},config:{...s.config}}}
let diffs=0; const N=1000;
for(let i=0;i<N;i++){reset(L);reset(RR); const bx=45+Math.floor(R()*115); const vx=-8+Math.floor(R()*7); // -8..-2, away from net
 const s={tick:3,side:'LEFT',self:{x:32+Math.floor(R()*153),y:244,state:0,frameNumber:0,divingDirection:0},opp:{x:248+Math.floor(R()*153),y:244,state:0,frameNumber:0,divingDirection:0},ball:{x:bx,y:190+Math.floor(R()*42),xVelocity:vx,yVelocity:5+Math.floor(R()*9),expectedLandingPointX:40+Math.floor(R()*130),isPowerHit:false},meta:{score:{self:0,opp:0},isPlayer2Serve:false,rallyFrameCount:10},config:{tickFrameGroupSize:3}};
 const a=L.decide(s), b=RR.decide(mirror(s)); if(a.x!==-b.x||a.y!==b.y||a.hit!==b.hit){diffs++; if(diffs<=5)console.log('DIFF',i,a,b,s)}}
console.log(JSON.stringify({checked:N,diffs,pass:diffs===0})); if(diffs)process.exitCode=1;
