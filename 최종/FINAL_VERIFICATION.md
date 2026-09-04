# Final verification

최종 패키징 직전 `PikaPlanner_v4.js`에 대해 다시 실행한 검사입니다.

- JavaScript syntax: PASS
- decide contract/benchmark: PASS, 900 calls
  - average: 3.214 ms/call
  - max: 24.122 ms/call in this container
- mirror sanity: PASS, 1000 / 1000 mirrored snapshots
- frozen-round regression: PASS, 52 / 52
- cushion regression: PASS
- `PikaPlanner_v4.js`, `PikaPlanner_v4_BASE.js`, `PikaPlanner_v4_SKILL_WORKING_COPY.js` SHA-256 identical at packaging time
- guide: 18-page A4 PDF; DOCX and PDF both rendered and all pages visually checked; black-and-white layout
- PDF preflight: openable, unencrypted, 18 pages, no form/XFA issue

## Tournament-harness spot checks
Corrected local tournament harness, seed 1, latency 1:
- tuned_v1: v4 LEFT 10-0, v4 RIGHT 10-0
- v05: v4 LEFT 10-5, v4 RIGHT 10-0
- v07: v4 LEFT 10-0 in the final spot check

These scores are regression indicators only. They are not estimates of real tournament win rate.
