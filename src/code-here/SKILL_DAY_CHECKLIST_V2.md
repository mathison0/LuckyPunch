# PikaPlanner v2 — 대회 당일 스킬 대응 체크리스트

스킬 공개 직후에는 전략 아이디어보다 **실행 순서와 물리 영향**을 먼저 확인합니다.

## 1. 새 snapshot 필드 표 만들기

- 필드명
- self/opp 대칭 여부
- 타입/범위
- null/undefined 가능 여부
- gauge / cooldown / active / remainingFrames 여부

`PikaPlanner_v2.js`의 `[C] SKILL ADAPTER -> read()`에서 한 번만 정규화합니다.

## 2. frame semantics 확인

반드시 실제 Chrome에서 확인:

- 기존 `{x,y,hit}`로 발동? 새 반환 필드?
- edge trigger / hold trigger?
- 어느 `state`에서 발동?
- player movement 전/후?
- ball world physics 전/후?
- player-ball collision 전/후?
- 지속 frame / recovery / cooldown?

## 3. 영향 범주로 분류

### 새 행동
`SKILL.extraActions()`, `SKILL.emergencyOverride()`

### 공 물리 변경
`SKILL.ballFrameHook()`

벽/네트 이벤트 순서와 스킬 적용 순서를 실제 구현 그대로 맞춥니다.

### 플레이어 reach 변경
`SKILL.reachActions()` 또는 `[H] PLAYER REACHABILITY`의 단일 helper만 확장.

### gauge/cooldown
`SKILL.read()` + `SKILL.evaluate()`.

## 4. 최소 probe 실험

각 상황에서 player/ball 값을 매 frame 기록:

1. 지상 정지
2. 좌/우 이동
3. 점프 상승
4. 점프 하강
5. 공 접촉 직전 / 같은 frame / 직후
6. 네트 상단 근처
7. 벽 반사 직전/직후
8. 상대 스킬과 동시 사용

## 5. 수정 후 검사 순서

```bash
node tools/verify_v2.mjs ./PikaPlanner_v2.js
node tools/cushion_regression.mjs ./PikaPlanner_v2.js
node tools/bench.mjs ./PikaPlanner_v2.js 2000
```

그 뒤 기존 skill-off v2와 A/B를 돌려 **스킬 코드를 추가한 것만으로 기본기가 약해지지 않았는지** 확인합니다.

## 6. 가능하면 건드리지 않을 영역

- canonicalization
- `[F] BALL PHYSICS + EVENTS`
- `[G] EXACT COLLISION RESPONSE`
- `executeSafely()`
- `ANTICIPATE → GROUND/JUMP → AIR_INTERCEPT → POWER` 계층

기본 엔진 자체가 변경된 경우에만 해당 영역을 수정합니다.

## 7. 스킬 가치 판단

```text
스킬 사용으로
- 내 contact window가 새로 생기는가?
- 상대의 full-trajectory intercept 가능성이 줄어드는가?
- 벽/네트 cushion을 새롭게 만들거나 무력화하는가?
- 상대의 reaction-lock 구간을 더 크게 이용할 수 있는가?
- 그 이득이 gauge/cooldown보다 큰가?
```
