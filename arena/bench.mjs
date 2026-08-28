// 종합 벤치마크: 후보 봇을 여러 상대·양쪽 진영·여러 지연에서 돌린다.
// 사용법: node bench.mjs <봇1,봇2,...> [세트수]
import path from 'node:path';
import { playSet, loadBot, makeRng } from './arena.mjs';
import { setCustomRng } from './rand.mjs';
import { fileURLToPath } from 'node:url';
// 저장소 어디서 실행해도 동작하도록 이 스크립트 위치 기준으로 잡는다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const D = path.join(HERE, '..', 'src', 'code-here') + '/';
const OPPONENTS = [
  { name: '기본AI', make: () => ({ kind: 'ai' }) },
  { name: 'v1', make: () => ({ kind: 'bot', decide: loadBot(D + 'LuckyPunch_v1.js', null) }) },
  { name: 'v2', make: () => ({ kind: 'bot', decide: loadBot(D + 'LuckyPunch_v2.js', null) }) },
  { name: 'v3', make: () => ({ kind: 'bot', decide: loadBot(D + 'LuckyPunch_v3.js', null) }) },
];
const OV = process.argv[4] ? Object.fromEntries(process.argv[4].split(',').map(p => { const [k,v]=p.split('='); return [k, Number(v)]; })) : null;
const LAGS = [1, 2, 3];

const bots = (process.argv[2] || 'LuckyPunch_v3.js').split(',');
const sets = Number(process.argv[3] || 10);

for (const botFile of bots) {
  console.log(`\n### ${path.basename(botFile, '.js')}`);
  let grandWin = 0, grandTot = 0, grandFor = 0, grandAgainst = 0;
  for (const opp of OPPONENTS) {
    const row = [];
    for (const lag of LAGS) {
      let win = 0, tot = 0, pf = 0, pa = 0;
      for (const asLeft of [true, false]) {
        for (let i = 0; i < sets; i++) {
          const rng = makeRng(9000 + i * 7919);
          setCustomRng(rng);
          const me = { kind: 'bot', decide: loadBot(D + botFile, OV) };
          const them = opp.make();
          const sides = asLeft ? [me, them] : [them, me];
          const r = playSet(sides, { winningScore: 10, applyLag: lag, rng, jitter: 8 });
          const mine = asLeft ? r.scores[0] : r.scores[1];
          const theirs = asLeft ? r.scores[1] : r.scores[0];
          if (mine > theirs) win++;
          tot++; pf += mine; pa += theirs;
        }
      }
      row.push(`lag${lag}: ${((win / tot) * 100).toFixed(0)}% (${pf}-${pa})`);
      grandWin += win; grandTot += tot; grandFor += pf; grandAgainst += pa;
    }
    console.log(`  vs ${opp.name.padEnd(6)} ${row.join('   ')}`);
  }
  console.log(`  ── 종합 승률 ${((grandWin / grandTot) * 100).toFixed(1)}%  득실 ${grandFor}-${grandAgainst}`);
}
