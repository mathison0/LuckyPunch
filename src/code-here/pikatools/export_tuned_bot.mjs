#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const input = path.resolve(arg('--bot', path.join(HERE, '../PikaPlanner_v1.js')));
const configPath = path.resolve(arg('--config', path.join(HERE, './best_config.json')));
const output = path.resolve(arg('--out', path.join(HERE, '../PikaPlanner_tuned_v1.js')));
const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const cfg = data.cfg || data;
const source = fs.readFileSync(input, 'utf8');
const json = JSON.stringify(cfg, null, 2);
const replaced = source.replace(
  /\/\* TUNED_CFG_START \*\/[\s\S]*?\/\* TUNED_CFG_END \*\//,
  `/* TUNED_CFG_START */ ${json} /* TUNED_CFG_END */`
);
if (replaced === source) throw new Error('TUNED_CFG markers not found');
fs.writeFileSync(output, replaced);
console.log(`wrote ${output}`);
