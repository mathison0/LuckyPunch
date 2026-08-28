// 사용법:
//   node run.mjs <leftSpec> <rightSpec> [세트수] [applyLag] [overrides]
//   spec: "ai" 또는 봇 파일 경로
//   overrides: "NAME=값,NAME=값" (왼쪽 봇에만 적용)
import path from 'node:path';
import { playSet, loadBot, makeRng } from './arena.mjs';
import { setCustomRng } from './rand.mjs';
import { fileURLToPath } from 'node:url';
// 저장소 어디서 실행해도 동작하도록 이 스크립트 위치 기준으로 잡는다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const CODE_DIR = path.join(HERE, '..', 'src', 'code-here');

function parseOverrides(str) {
  if (!str) return null;
  const out = {};
  for (const pair of str.split(',')) {
    const [k, v] = pair.split('=');
    out[k.trim()] = Number(v);
  }
  return out;
}

function makeSide(spec, overrides) {
  if (spec === 'ai') return { kind: 'ai', label: '기본AI' };
  const file = spec.includes('/') || spec.includes('\\') ? spec : path.join(CODE_DIR, spec);
  return { kind: 'bot', decide: loadBot(file, overrides), label: path.basename(file, '.js') };
}

const [, , leftSpec, rightSpec, setsArg, lagArg, ovArg] = process.argv;
const sets = Number(setsArg || 40);
const applyLag = Number(lagArg || 1);
const overrides = parseOverrides(ovArg);

const left = makeSide(leftSpec, overrides);
const right = makeSide(rightSpec, null);

let wins = [0, 0];
let pts = [0, 0];
let totalFrames = 0;
let errors = [0, 0];

for (let i = 0; i < sets; i++) {
  const rng = makeRng(1000 + i * 7919);
  setCustomRng(rng); // 엔진 내부 rand()도 결정론적으로
  const r = playSet([left, right], { winningScore: 10, applyLag, rng });
  if (r.scores[0] > r.scores[1]) wins[0]++;
  else wins[1]++;
  pts[0] += r.scores[0];
  pts[1] += r.scores[1];
  totalFrames += r.frames;
  errors[0] += r.errors[0];
  errors[1] += r.errors[1];
}

const pct = ((wins[0] / sets) * 100).toFixed(1);
console.log(
  `${left.label} (L) vs ${right.label} (R)  lag=${applyLag}` +
    (ovArg ? `  [${ovArg}]` : '') +
    `\n  세트 ${wins[0]}-${wins[1]}  (승률 ${pct}%)  득점 ${pts[0]}-${pts[1]}` +
    `  평균 ${Math.round(totalFrames / sets)}프레임/세트  예외 ${errors[0]}/${errors[1]}`
);
