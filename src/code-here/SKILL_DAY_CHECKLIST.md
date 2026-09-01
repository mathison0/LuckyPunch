# 대회 당일 스킬 대응 체크리스트

스킬 공개 직후에는 전략부터 고민하지 말고 **frame semantics와 물리 변화부터 측정**합니다.

## 1. 새 snapshot 필드 기록

필드 이름/타입/범위를 그대로 적습니다.

- self에 추가됐나?
- opp에도 대칭으로 있나?
- gauge/cooldown/active/remainingFrames가 있나?
- null/undefined가 가능한가?

그리고 `PikaPlanner_v1.js`의 `[C] SKILL ADAPTER -> read()`에서 한 번만 정규화합니다.

## 2. 발동 입력 semantics 확인

- 기존 `{x,y,hit}` 조합으로 발동하는가, 새 반환 필드가 생기는가?
- edge-trigger인가 hold-trigger인가?
- state 0/1/2/3 중 어디서 발동 가능한가?
- engine frame에서 movement 전/후, collision 전/후 어디에 적용되는가?
- 몇 frame 지속되는가?
- 중간에 취소 가능한가?

**버튼 설명보다 실행 순서가 중요합니다.**

## 3. 스킬을 네 종류로 분류

### A. 새로운 행동
예: dash, shield, special hit

수정:
- `SKILL.extraActions()`
- 필요 시 `SKILL.emergencyOverride()`

### B. 공/게임 물리 변경
예: ball acceleration, gravity change, trajectory bend

수정:
- `SKILL.simulateBallHook()`
- 필요 시 `[E] EXACT PHYSICS SIMULATOR`
- `tools/probe.mjs`

### C. 플레이어 reachability 변경
예: dash, teleport, double jump, hitbox expansion

수정:
- `SKILL.transformReachability()`
- 필요 시 `[F] REACHABILITY`

### D. resource / cooldown
예: gauge 100 소비, 5초 cooldown

수정:
- `SKILL.read()`
- `SKILL.evaluate()`

## 4. 가장 먼저 할 실험

한 조건만 바꿔 각각 10~30회 관찰합니다.

1. 가만히 서서 skill만 사용
2. 좌/우 이동 중 사용
3. 점프 상승 중 사용
4. 점프 하강 중 사용
5. 공과 겹치기 1 frame 전 / 같은 frame / 1 frame 후 사용
6. 네트 바로 앞/뒤 사용
7. 상대 skill과 동시에 사용
8. gauge가 0, 직전, 가득 찼을 때 사용

기록할 것:

- player x/y/state 변화
- ball x/y/vx/vy 변화
- collision 결과
- 지속 frame
- recovery/cooldown

## 5. 수정 순서

1. `SKILL.read()`
2. simulator/probe가 새 물리를 재현하도록 수정
3. 내/상대 reachability 반영
4. candidate action 추가
5. resource value 추가
6. `node tools/verify.mjs`
7. latency sweep
8. 실제 Chrome LEFT/RIGHT 테스트

## 6. 당일 웬만하면 건드리지 않을 부분

- 좌우 canonicalization
- 공개 기본 physics
- 기본 collision 식
- `executeSafely()`의 dive/re-jump 보호
- core `planCore()` 구조

새 skill 때문에 이 네 영역을 대폭 고쳐야 한다면 먼저 adapter로 우회할 방법이 없는지 확인합니다.

## 7. 스킬 가치 판단식

최종적으로 다음 질문만 답하면 됩니다.

```text
이 스킬을 지금 쓰면
  내 다음 contact가 좋아지는가?
  상대 다음 contact를 어렵게 만드는가?
  상대 reachable set을 줄이는가?
  내 reachable set을 늘리는가?
  그 이득이 gauge/cooldown 비용보다 큰가?
```

스킬이 화려하더라도 이 다섯 질문에 이득이 없으면 사용하지 않는 게 맞습니다.
