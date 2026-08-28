// 미러 자기대전으로 파라미터를 튜닝한다.
// 후보 설정과 기준 설정을 좌/우 바꿔가며 같은 시드로 붙여 좌우 편향을 없앤다.
//
// 사용법: node tune.mjs <봇파일> <PARAM> <값1,값2,...> [세트수] [applyLag] [기준override]
import path from 'node:path';
import { playSet, loadBot, makeRng } from './arena.mjs';
import { setCustomRng } from './rand.mjs';
import { fileURLToPath } from 'node:url';
// 저장소 어디서 실행해도 동작하도록 이 스크립트 위치 기준으로 잡는다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const CODE_DIR = path.join(HERE, '..', 'src', 'code-here');

function parseOv(str) {
  if (!str) return {};
  const out = {};
  for (const p of str.split(',')) {
    const [k, v] = p.split('=');
    out[k.trim()] = Number(v);
  }
  return out;
}

/** A(후보) vs B(기준)를 미러로 붙여 A의 승률/득실을 반환 */
export function duel(file, ovA, ovB, sets, applyLag) {
  const A = { kind: 'bot', decide: loadBot(file, ovA) };
  const B = { kind: 'bot', decide: loadBot(file, ovB) };
  let winA = 0, winB = 0, ptsA = 0, ptsB = 0;
  for (let i = 0; i < sets; i++) {
    const seed = 5000 + i * 7919;
    // A가 왼쪽
    let rng = makeRng(seed); setCustomRng(rng);
    let r = playSet([A, B], { winningScore: 10, applyLag, rng });
    if (r.scores[0] > r.scores[1]) winA++; else winB++;
    ptsA += r.scores[0]; ptsB += r.scores[1];
    // A가 오른쪽 (같은 시드)
    rng = makeRng(seed); setCustomRng(rng);
    r = playSet([B, A], { winningScore: 10, applyLag, rng });
    if (r.scores[1] > r.scores[0]) winA++; else winB++;
    ptsA += r.scores[1]; ptsB += r.scores[0];
  }
  return { winA, winB, ptsA, ptsB, rate: winA / (winA + winB) };
}

const [, , botArg, param, valuesArg, setsArg, lagArg, baseOvArg] = process.argv;
const file = botArg.includes('/') || botArg.includes('\\') ? botArg : path.join(CODE_DIR, botArg);
const values = valuesArg.split(',').map(Number);
const sets = Number(setsArg || 15);
const applyLag = Number(lagArg || 1);
const baseOv = parseOv(baseOvArg);

console.log(`${path.basename(file)} — ${param} 스윕 (기준: 현재값, 미러 ${sets * 2}세트, lag=${applyLag})`);
for (const v of values) {
  const ovA = Object.assign({}, baseOv);
  ovA[param] = v;
  const r = duel(file, ovA, baseOv, sets, applyLag);
  const bar = '█'.repeat(Math.round(r.rate * 30));
  console.log(
    `  ${param}=${String(v).padStart(5)}  승률 ${(r.rate * 100).toFixed(1).padStart(5)}%  ` +
      `(${r.winA}-${r.winB})  득실 ${r.ptsA}-${r.ptsB}  ${bar}`
  );
}
