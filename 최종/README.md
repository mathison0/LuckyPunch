# PikaPlanner v4 - Final Field Package

현재 기준 제출 baseline은 `PikaPlanner_v4.js`입니다.

## 당일 시작 순서
1. `PikaPlanner_v4_Field_Guide.pdf`의 0장과 5장을 먼저 봅니다.
2. `PikaPlanner_v4_BASE.js`는 절대 수정하지 않습니다.
3. `PikaPlanner_v4_SKILL_WORKING_COPY.js`를 팀 제출 파일명으로 복사해 새 스킬을 적용합니다.
4. 새 repository / API / 제공 skill bot에서 사실을 먼저 확인합니다.
5. 방어(reach/threat/ball physics)를 먼저 연결하고, 그 다음 우리 스킬 사용을 추가합니다.
6. 한 번에 하나만 바꾸고 A/B 테스트합니다.
7. 제출 직전 `MATCHDAY_60MIN_CHECKLIST.md`와 가이드 14장을 확인합니다.

## 중요한 파일
- `PikaPlanner_v4.js` - 현재 깨끗한 baseline
- `PikaPlanner_v4_BASE.js` - 되돌리기용 보존본
- `PikaPlanner_v4_SKILL_WORKING_COPY.js` - 당일 작업 시작본
- `PikaPlanner_v4_Field_Guide.pdf` - 메인 현장 가이드
- `MATCHDAY_60MIN_CHECKLIST.md` - 1시간 압축 체크리스트
- `SKILL_FACTS_WORKSHEET.md` - 공개 스킬 사실 기록지
- `TEST_LOG_TEMPLATE.md` - A/B 실험 기록지
- `TOURNAMENT_RULES_NOTES.md` - 규칙이 전략에 주는 의미
- `QNA_NOTES.md` - 운영진 Q&A에서 얻은 핵심
- `V4_CHANGELOG.md` - v4가 해결한 문제와 남은 주의점

## 기본 검사
```bash
node --check PikaPlanner_v4.js
node tools/verify_v4.mjs PikaPlanner_v4.js
node tools/mirror_sanity.mjs PikaPlanner_v4.js
node tools/frozen_round_regression.mjs PikaPlanner_v4.js
node tools/cushion_regression.mjs PikaPlanner_v4.js
```

## 대진 회귀 테스트 예시
```bash
node tools/tournament_one.mjs v05 LEFT 1
node tools/tournament_one.mjs v07 RIGHT 1
node tools/tournament_matrix.mjs 1,7920
```

이 simulator의 승패는 실제 대회 승률 예측이 아니라 회귀 테스트입니다. 당일 공개 repository가 최종 권위입니다.
