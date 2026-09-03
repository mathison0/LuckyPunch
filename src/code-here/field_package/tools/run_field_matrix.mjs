#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeries } from './sim_engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const bot = path.resolve(arg('--bot', path.join(ROOT, 'PikaPlanner_v2_1_stable_candidate.js')));
const matches = Number(arg('--matches', '12'));
const seed = Number(arg('--seed', '1001'));
const latency = Number(arg('--latency', '1'));
const opponents = [
  path.join(ROOT, 'opponents/LuckyPunch_v11_opponent.js'),
  path.join(ROOT, 'opponents/LuckyPunch_v16_opponent.js'),
  path.join(ROOT, 'reference/PikaPlanner_v2_reference.js'),
];
const rows = [];
for (const opp of opponents) {
  const left = runSeries({ leftFile: bot, rightFile: opp, matches, seed, latencySet: [latency] });
  const rightRaw = runSeries({ leftFile: opp, rightFile: bot, matches, seed: seed + 500000, latencySet: [latency] });
  rows.push({
    opponent: path.basename(opp),
    botAsLeft: { wins: left.leftWins, losses: left.rightWins, draws: left.draws, avgPointDiff: left.avgPointDiff },
    botAsRight: { wins: rightRaw.rightWins, losses: rightRaw.leftWins, draws: rightRaw.draws, avgPointDiff: -rightRaw.avgPointDiff },
  });
}
console.log(JSON.stringify({ bot, matchesPerOrientation: matches, latency, seed, rows }, null, 2));
