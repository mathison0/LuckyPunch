# PikaPlanner v2 — 사용법 / 검증 / 리플레이

## 1. 제출 후보

`PikaPlanner_v2.js`가 이번 재설계본입니다.

대회 저장소에서는 예를 들어 다음처럼 복사해서 쓰면 됩니다.

```bash
cp PikaPlanner_v2.js <대회저장소>/src/code-here/MyTeam_v2.js
```

그 뒤 대회 저장소에서 `npm start` → Chrome → 봇 설정 → 적용(재시작).

> 최종 제출 판단은 반드시 실제 Chrome 대회 엔진에서 하세요. `tools/`의 simulator는 빠른 회귀/A-B 분석용입니다.

---

## 2. v2에서 근본적으로 바뀐 것

### 착지점 평가 → 전체 궤적 평가

v1은 물리적으로 벽/네트 반사를 계산했지만 공격/수비 평가의 상당 부분이 최종 `landingX`로 압축됐습니다. v2는 각 프레임의 공 위치와 다음 이벤트를 끝까지 유지합니다.

- `WALL_LEFT`, `WALL_RIGHT`
- `NET_TOP`
- `NET_SIDE_LEFT`, `NET_SIDE_RIGHT`
- `CEILING`, `GROUND`

후보 공격마다 전체 궤적 중 **상대가 어느 프레임에서라도 접촉 가능한지**를 검사합니다. 따라서 벽 쿠션이나 네트 윗부분 재상승은 예외처리가 아니라 일반 궤적의 일부입니다.

### 상대 접촉 이전에는 commit 금지

공이 상대 코트에 있고 상대가 곧 접촉 가능한 동안에는 현재 `expectedLandingPointX`를 보고 점프하지 않습니다.

`ANTICIPATE → 실제 상대 타격 → RECEIVE/JUMP` 순서입니다.

### 지상 planner와 공중 planner 분리

한번 점프하면 지상 낙하지점 planner가 수평 이동을 빼앗지 않습니다.

- `JUMP_INTERCEPT`: 점프 시작
- `AIR_INTERCEPT`: 현재 점프 궤적과 새 공 궤적을 다시 맞춤
- `POWER`: 실제 파워히트 후보 rollout

쿠션으로 공 경로가 바뀌어도 공중에서 새 접촉점을 다시 계산합니다.

### 반응 잠금(reaction lock)

상대가 공을 친 직후 2~4프레임은 새 snapshot을 보고 만든 수비 입력이 아직 적용되지 않을 수 있습니다. v2의 상대 공격 사전 수비는 이 구간을 직접 고려합니다. 그래서 빠른 짧은 스매시와 늦은 방향전환 쿠션에 대해 네트 쪽 선제 위치가 더 중요해집니다.

### 파워히트 수직속도 단일 구현

실제 엔진 순서 그대로:

```text
일반 충돌 처리 → |vy|가 15보다 작으면 15로 보정 → power hit에서 2배
```

즉 파워히트 수직속도 크기는 `2 * max(abs(preContactVy), 15)`입니다. 공격/상대 위협 예측 모두 같은 함수 하나를 사용합니다.

---

## 3. 가장 먼저 돌릴 검사

패키지 루트에서:

```bash
node tools/verify_v2.mjs ./PikaPlanner_v2.js
node tools/cushion_regression.mjs ./PikaPlanner_v2.js
node tools/bench.mjs ./PikaPlanner_v2.js 2000
```

현재 제작 시점의 참고값(Node simulator):

- invalid action: 0
- `decide()` 평균: 약 2.8ms/call

브라우저/PC에 따라 달라질 수 있습니다.

---

## 4. v1과 A/B 대전

### v2 LEFT

```bash
node tools/run_series.mjs \
  --left ./PikaPlanner_v2.js \
  --right ./PikaPlanner_tuned_v1.js \
  --matches 20 \
  --seed 31001 \
  --latency 1
```

### 좌우 교환

```bash
node tools/run_series.mjs \
  --left ./PikaPlanner_tuned_v1.js \
  --right ./PikaPlanner_v2.js \
  --matches 20 \
  --seed 41001 \
  --latency 1
```

실제 JS Worker는 `decide()`가 수 ms면 보통 다음 40ms engine frame 전에 응답할 가능성이 높아서 `latency=1`이 가장 중요한 기준입니다. 그래도 강건성 검사용으로 2도 시험하세요.

```bash
... --latency 2
```

3프레임 지연은 심한 scheduling stall에 가까운 스트레스 테스트로 보세요.

---

## 5. 경기 비주얼라이즈

### 리플레이 생성

```bash
node tools/replay.mjs \
  --left ./PikaPlanner_v2.js \
  --right ./PikaPlanner_tuned_v1.js \
  --seed 42 \
  --score 10 \
  --out ./tools/replay.json
```

### 보기

`tools/replay_viewer.html`을 Chrome에서 열고 `replay.json`을 선택합니다.

표시되는 것:

- 플레이어 / 공 위치
- 최근 공 궤적 trail
- 현재 `expectedLandingPointX`
- `WALL_*`, `NET_TOP`, `NET_SIDE_*` 이벤트
- 양쪽 action
- v2라면 내부 plan (`ANTICIPATE`, `JUMP_INTERCEPT`, `AIR_INTERCEPT`, `POWER`, `CLEAR` 등)
- 점수 / 득점 frame

쿠션 대응을 튜닝할 때는 **득점 직전 프레임을 뒤로 넘기면서** `events`와 `plan`을 같이 보는 게 가장 빠릅니다.

---

## 6. 스킬 공개 당일 수정 영역

`PikaPlanner_v2.js`에서 우선 `[C] SKILL ADAPTER`만 봅니다.

### 새 입력/행동

`SKILL.extraActions()` 또는 `SKILL.emergencyOverride()`.

### 공 물리 변경

`SKILL.ballFrameHook()`.

### dash / teleport / hitbox 증가 등 도달성 변경

`SKILL.reachActions()` 또는 필요하면 reachability helper 한 곳만 확장.

### gauge/cooldown/resource

`SKILL.read()` + `SKILL.evaluate()`.

### 당일 되도록 건드리지 말 것

- `[F] BALL PHYSICS + EVENTS`
- `[G] EXACT COLLISION RESPONSE`
- canonicalization
- action safety executor

스킬이 기본 물리 자체를 바꾸지 않는 한 이 영역은 봉인하는 편이 안전합니다.

---

## 7. 현재 남아 있는 모델링 한계

1. snapshot에 플레이어 `yVelocity`가 없어 이전 snapshot과 공개 점프/다이브 표로 복원합니다.
2. `state=2`의 `delayBeforeNextFrame`도 snapshot에 없습니다. v2는 공격을 과대평가하지 않도록 짧은 잔여시간을 가정합니다.
3. 상대 reachability는 강한 상대를 상정해 일부러 약간 과대평가합니다.
4. offline simulator는 실제 Chrome Worker scheduling, 라운드 fade/slow-motion 전체를 완전히 재현하지 않습니다.
5. 당일 skill은 미공개이므로 현재 adapter는 no-op입니다.

---

## 8. 추천 개발 루프

```text
한 가지 변경
↓
verify_v2
↓
cushion_regression
↓
bench
↓
v1/baseline과 LEFT/RIGHT A-B
↓
replay 생성 → 실점 장면 프레임 단위 분석
↓
실제 Chrome 엔진에서 관전
↓
좋을 때만 새 버전으로 보존
```

파일을 덮어쓰지 말고 `MyTeam_v2_1.js`, `MyTeam_v2_2.js` 식으로 남겨두는 것을 권장합니다.
