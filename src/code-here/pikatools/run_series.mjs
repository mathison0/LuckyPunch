#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeries } from './sim_engine.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const left = path.resolve(arg('--left', path.join(HERE, '../PikaPlanner_tuned_v1.js')));
const right = path.resolve(arg('--right', path.join(HERE, './BaselineAggressive_v1.js')));
const matches = Number(arg('--matches', '30'));
const seed = Number(arg('--seed', '1'));
const latency = String(arg('--latency', '1,2,3')).split(',').map(Number).filter(Number.isFinite);

const result = runSeries({
  leftFile: left,
  rightFile: right,
  matches,
  seed,
  latencySet: latency.length ? latency : [1],
});
console.log(JSON.stringify({ left, right, ...result, scores: undefined }, null, 2));
