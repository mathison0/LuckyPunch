# PikaPlanner v2.1 - Field Day Checklist

## 0. Baseline freeze
- `PikaPlanner_v2_1_stable_candidate.js`는 반드시 별도 보존한다.
- 현장 수정은 복사본에서만 한다.
- 스킬 공개 전에는 평가함수/전술 우선순위를 건드리지 않는다.

## 1. 스킬 공개 직후 5분
1. snapshot에 추가된 필드 이름/단위/범위를 적는다.
2. 스킬을 아래 중 하나 이상으로 분류한다.
   - 정보/게이지/쿨다운
   - 새 action
   - 공 physics 변화
   - player reach/hitbox 변화
   - collision/공격 결과 변화
3. 기존 필드의 의미가 정말 불변인지 공개 코드/설명으로 확인한다.
4. `SKILL` adapter 밖의 core를 바로 수정하지 않는다.

## 2. 수정 순서
- 정보만 추가: `SKILL.read` -> `SKILL.evaluate`
- 공 physics: `SKILL.ballFrameHook` + 실제 공개 frame order 검증
- 새 tactical action: `SKILL.extraActions`
- emergency 전용: `SKILL.emergencyOverride`
- reach/hitbox 변화: 현재 `reachActions`는 예약 훅이고 core에 아직 연결되지 않았으므로 `canPlayerReachBallAt` 및 self contact planner 양쪽을 명시적으로 패치
- player physics/state 자체 변화: `estimatePlayerVy`, `neutralVerticalTimeline`, `stepSelfExact`까지 같은 규칙으로 동기화

## 3. 수정 후 즉시 실행
```bash
node tools/verify_v2.mjs ./PikaPlanner_v2_1_annotated.js
node tools/cushion_regression.mjs ./PikaPlanner_v2_1_annotated.js
node tools/bench.mjs ./PikaPlanner_v2_1_annotated.js 2000
```

## 4. 상대 2개 회귀
- 상대 A: `opponents/LuckyPunch_v11_opponent.js`
- 상대 B: `opponents/LuckyPunch_v16_opponent.js`
- 반드시 좌/우를 바꿔서 돌린다.
- 먼저 latency=1, 그 다음 latency=2 스트레스 테스트.

```bash
node tools/run_field_matrix.mjs --bot ./PikaPlanner_v2_1_annotated.js --matches 12
```

## 5. 실패 로그 우선순위
1. touch-limit 실점
2. 자기 코트 power/self-score
3. planner mode와 실제 첫 contact 불일치
4. RIGHT에서만 발생하는 net-center 이상
5. 빠른 하방샷을 1-4 px 차이로 놓침
6. jump 후 ground planner가 다시 개입하는지
7. state2/착지 직전 stale `hit`/`y=-1`

## 6. 현장 금지사항
- 한 번에 여러 weight를 같이 튜닝하지 않는다.
- 한두 seed의 5:0만 보고 채택하지 않는다.
- 상대 B의 경기 중 적응을 "우리 코드가 갑자기 고장남"으로 오인하지 않는다.
- latency가 불확실할 때 `ACTION_LATENCY` 하나만 바꾼 뒤 끝내지 않는다. receive first-contact와 power timing 모두 같이 회귀해야 한다.
- `reachActions`가 자동으로 동작한다고 가정하지 않는다.

## 7. 제출 직전
- DEBUG=0 / DEBUG_EXPORT=0 확인
- imports/fetch/DOM 없음 확인
- top-level `decide` 유지
- 파일 크기 4MB 이하 확인
- verify/cushion/bench 마지막 1회
- 제출 파일 SHA 또는 복사본 보관
