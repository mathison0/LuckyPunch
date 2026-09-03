# PikaPlanner v2 핵심 변경 기록

- 최종 landing 기반 공격평가를 full-trajectory intercept 평가로 교체.
- 벽/네트 상단/네트 측면 이벤트를 물리 rollout에 명시적으로 보존.
- 상대가 아직 공을 칠 수 있으면 현재 free trajectory에 점프 commit 금지.
- 상대 contact-first threat generation 추가.
- 상대 타격 직후 2~4 frame reaction lock을 defensive standby에 반영.
- `GROUND RECEIVE`와 `AIR INTERCEPT` planner 분리.
- 점프 첫 3-frame held-x를 직접 평가해 overshoot 감소.
- 파워히트 `2*max(abs(vy),15)` 순서를 공격/수비 공통 collision 함수로 통일.
- state2 hidden delay는 보수적으로 처리.
- replay JSON + HTML viewer 추가.
- cushion regression suite 추가.
