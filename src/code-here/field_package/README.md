# PikaPlanner v2.1 Field Package

이 패키지는 v2.1 stable candidate를 대회 현장에서 이해/확장/회귀 테스트하기 위한 묶음입니다.

## 핵심 파일
- `PikaPlanner_v2_1_stable_candidate.js`: 제출 기준선. 수정 전 반드시 별도 보존.
- `PikaPlanner_v2_1_annotated.js`: 실행 로직은 stable candidate와 같고 해설 주석을 대폭 추가한 읽기/현장 수정용 사본.
- `PikaPlanner_v2_1_Field_Guide.pdf`: 전략, 물리, planner 구조, 알려진 약점, 스킬 확장, 테스트/디버깅 22페이지 가이드.
- `FIELD_DAY_CHECKLIST.md`: 스킬 공개 당일 체크리스트.
- `SKILL_DAY_PATCH_TEMPLATE.md`: 공개 사실/수정 위치/회귀 결과를 적는 템플릿.

## 테스트 상대
- `opponents/LuckyPunch_v11_opponent.js`
- `opponents/LuckyPunch_v16_opponent.js`

## reference
- `reference/PikaPlanner_v2_reference.js`: v2 기준선.
- `reference/V2_1_DIAGNOSTIC.md`: v2.1 안정화 진단 메모.

## 기본 검증
```bash
node tools/verify_v2.mjs ./PikaPlanner_v2_1_stable_candidate.js
node tools/cushion_regression.mjs ./PikaPlanner_v2_1_stable_candidate.js
node tools/bench.mjs ./PikaPlanner_v2_1_stable_candidate.js 2000
```

## 회귀 매트릭스
```bash
node tools/run_field_matrix.mjs --bot ./PikaPlanner_v2_1_stable_candidate.js --matches 12 --latency 1
```

`run_field_matrix.mjs`는 simulator 기반 참고용입니다. 실제 Chrome Worker timing과 완전히 동일한 대회 승률 예측으로 해석하지 마세요.

## 중요한 주의
현재 `SKILL.reachActions()`는 예약 훅이지만 core에서 호출되지 않습니다. 스킬이 dash/teleport/hitbox 확대처럼 reachability를 바꾸는 경우 PDF 21~22장의 안내대로 reachability와 self contact planner를 함께 연결해야 합니다.
