#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, BotScheduler, loadBot } from './sim_engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const leftFile = path.resolve(arg('left', path.join(HERE, '../PikaPlanner_v2.js')));
const rightFile = path.resolve(arg('right', path.join(HERE, 'BaselineAggressive_v1.js')));
const outFile = path.resolve(arg('out', path.join(HERE, 'replay.json')));
const seed = Number(arg('seed', 1));
const latencyLeft = Number(arg('latency-left', 1));
const latencyRight = Number(arg('latency-right', 1));
const winningScore = Number(arg('score', 10));
const maxFrames = Number(arg('max-frames', 6000));

const engine = new Engine(seed);
const debugCfg = { DEBUG_EXPORT: 1 };
const leftBot = loadBot(leftFile, debugCfg);
const rightBot = loadBot(rightFile, debugCfg);
const left = new BotScheduler(leftBot, 'LEFT', latencyLeft);
const right = new BotScheduler(rightBot, 'RIGHT', latencyRight);
engine.resetRound(null);

const frames = [];
const points = [];
while (engine.scores[0] < winningScore && engine.scores[1] < winningScore && engine.frame < maxFrames) {
  const a1 = left.beforeFrame(engine);
  const a2 = right.beforeFrame(engine);
  const result = engine.step(a1, a2);
  const fs = engine.frameState(a1, a2, result);
  fs.debugLeft = left.latestDebug;
  fs.debugRight = right.latestDebug;
  frames.push(fs);
  if (result) {
    points.push({ frame: engine.frame, ...result, score: [...engine.scores] });
    if (engine.scores[0] >= winningScore || engine.scores[1] >= winningScore) break;
    engine.resetRound(null);
  }
}

const data = {
  meta: {
    left: path.basename(leftFile),
    right: path.basename(rightFile),
    seed,
    latencyLeft,
    latencyRight,
    finalScore: [...engine.scores],
    totalFrames: engine.frame,
  },
  points,
  frames,
};
fs.writeFileSync(outFile, JSON.stringify(data));
console.log(`wrote ${outFile}`);
console.log(JSON.stringify(data.meta, null, 2));
