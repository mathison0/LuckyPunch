#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSeries, mulberry32 } from './sim_engine.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const botFile = path.resolve(arg('--bot', path.join(HERE, '../PikaPlanner_v1.js')));
const generations = Number(arg('--generations', '6'));
const population = Number(arg('--population', '10'));
const matchesPerOpponent = Number(arg('--matches', '8'));
const seed = Number(arg('--seed', '12345'));
const output = path.resolve(arg('--out', path.join(HERE, './best_config.json')));
const rng = mulberry32(seed);

const opponents = [
  path.join(HERE, './BaselinePositioning_v1.js'),
  path.join(HERE, './BaselineAggressive_v1.js'),
];

const SPACE = {
  MOVE_DEADBAND: [3, 8, true],
  STANDBY_X: [92, 126, true],
  BODY_RECEIVE_OFFSET: [18, 31, true],
  BODY_RECEIVE_OFFSET_NEAR_NET: [12, 24, true],
  JUMP_SEARCH_HORIZON: [16, 27, true],
  POWER_ARM_DISTANCE_X: [42, 64, true],
  POWER_ARM_DISTANCE_Y: [44, 72, true],
  DOWN_SMASH_MAX_NET_DISTANCE: [70, 105, true],
  DIVE_MAX_LOOKAHEAD: [8, 15, true],
  SHOT_REACH_MARGIN_WEIGHT: [1.2, 3.5, false],
  SHOT_DISTANCE_WEIGHT: [0.10, 0.55, false],
  SHOT_TIME_PRESSURE_WEIGHT: [14, 45, false],
  JUMP_ATTACK_BONUS: [12, 42, false],
  CONTACT_LATE_PENALTY: [0.10, 0.60, false],
};

function randomValue([lo, hi, integer]) {
  const v = lo + (hi - lo) * rng();
  return integer ? Math.round(v) : Math.round(v * 1000) / 1000;
}
function randomCfg() {
  const c = {};
  for (const [k, spec] of Object.entries(SPACE)) c[k] = randomValue(spec);
  return c;
}
function mutate(base, scale) {
  const c = { ...base };
  for (const [k, [lo, hi, integer]] of Object.entries(SPACE)) {
    if (rng() > 0.55) continue;
    const span = hi - lo;
    let v = c[k] + (rng() * 2 - 1) * span * scale;
    v = Math.max(lo, Math.min(hi, v));
    c[k] = integer ? Math.round(v) : Math.round(v * 1000) / 1000;
  }
  return c;
}

function evaluate(cfg, evalSeed) {
  let score = 0;
  const details = [];
  for (let i = 0; i < opponents.length; i++) {
    const r1 = runSeries({
      leftFile: botFile,
      rightFile: opponents[i],
      leftCfg: cfg,
      matches: matchesPerOpponent,
      seed: evalSeed + i * 100003,
      latencySet: [1, 2, 3],
    });
    // Side-swap to expose hidden left/right implementation mistakes.
    const r2 = runSeries({
      leftFile: opponents[i],
      rightFile: botFile,
      rightCfg: cfg,
      matches: matchesPerOpponent,
      seed: evalSeed + i * 100003 + 50001,
      latencySet: [1, 2, 3],
    });
    const candidateWinRate = (r1.leftWins + r2.rightWins) / (2 * matchesPerOpponent);
    const pointDiff = (r1.avgPointDiff - r2.avgPointDiff) / 2;
    score += candidateWinRate * 100 + pointDiff * 1.5;
    details.push({ opponent: path.basename(opponents[i]), candidateWinRate, pointDiff });
  }
  return { score, details };
}

let best = { cfg: randomCfg(), score: -Infinity, details: [] };
for (let g = 0; g < generations; g++) {
  const candidates = [];
  if (g === 0) {
    for (let i = 0; i < population; i++) candidates.push(randomCfg());
  } else {
    candidates.push(best.cfg);
    while (candidates.length < population) {
      candidates.push(mutate(best.cfg, Math.max(0.04, 0.28 * (1 - g / generations))));
    }
  }

  let genBest = null;
  for (let i = 0; i < candidates.length; i++) {
    const res = evaluate(candidates[i], seed + g * 1000003 + i * 7919);
    if (!genBest || res.score > genBest.score) genBest = { cfg: candidates[i], ...res };
    process.stdout.write(`gen ${g + 1}/${generations} candidate ${i + 1}/${population} score=${res.score.toFixed(2)}\n`);
  }
  if (genBest.score > best.score) best = genBest;
  console.log('generation best:', JSON.stringify(genBest, null, 2));
  fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), botFile, ...best }, null, 2));
}

console.log('\nFINAL BEST');
console.log(JSON.stringify(best, null, 2));
console.log(`saved: ${output}`);
