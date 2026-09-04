# 2. 당일 패치 경로 - 게이지 + 대시/텔레포트 가정

## 목표
현재 v2.1의 좋은 부분(공 시뮬레이션, 공격 평가, ANTICIPATE, AIR_INTERCEPT, 안전 실행기)은 유지한다.
스킬 때문에 바뀐 규칙만 연결한다.

---

## 단계 0 - 아무 코드도 고치기 전에 실측

다음을 먼저 확정한다.

- 게이지 필드 이름 / 범위 / 초기값
- 상대 게이지도 snapshot에서 보이는가
- 게이지 충전 조건
- 한 번 사용 비용
- 랠리/세트 사이 유지 여부
- 쿨다운 유무
- 스킬 입력 방법
- 발동 가능한 player state
- 지상/공중 사용 가능 여부
- 발동 프레임에 몇 px 움직이는가
- 여러 프레임 지속되는가
- 이동 중 x 입력의 의미
- 공과 충돌하면 일반 충돌인가 특수 충돌인가
- 발동 직후 power hit이 가능한가
- 스킬이 ball update보다 앞/뒤 어느 순서에 적용되는가
- action이 3프레임 유지될 때 스킬이 매 프레임 재발동하는가, 1회만 발동하는가

**이 순서를 모르면 전략을 짜지 않는다.** 먼저 5~20개의 짧은 브라우저 실험을 한다.

---

## 단계 1 - snapshot 읽기만 연결

`SKILL.read(snapshot)`에서 아래처럼 정규화한다.

```js
return {
  enabled: true,
  selfGauge: ...,
  oppGauge: ...,
  selfReady: ...,
  oppReady: ...,
  selfCooldown: ...,
  oppCooldown: ...,
  selfActive: ...,
  oppActive: ...,
};
```

처음에는 읽기만 하고 행동은 바꾸지 않는다.
디버그 로그로 실제 값이 예상대로 변하는지 확인한다.

---

## 단계 2 - 새 action 형식 연결

### 경우 A: 기존 x/y/hit 조합으로 발동
기존 `action()` 구조를 거의 유지할 수 있다.
발동 조건만 executor에서 정확히 관리한다.

### 경우 B: `skill`, `dash`, `ability` 같은 새 action 필드 추가
반드시 아래 전체를 같이 수정한다.

- `action()`
- `cloneAction()`
- `uncanonicalize()`
- `executeSafely()`
- `decide()` 반환값
- simulator에서 action 적용 부분

**`SKILL.extraActions()`만 수정하면 부족하다.** 현재 v2.1의 `action()`은 x/y/hit만 남기기 때문이다.

---

## 단계 3 - 이동 스킬의 "정확한 1프레임 물리"를 만든다

예시 추상 모델:

```text
DASH:
activation frame: x += ?
duration: ? frames
speed: ? px/frame
can steer: yes/no
can jump during dash: yes/no
can hit during dash: yes/no
state after dash: ?
```

텔레포트라면:

```text
TELEPORT:
target selection: direction / fixed distance / exact target?
teleport occurs before or after ball movement?
can overlap ball immediately?
collision is checked in same frame?
```

이 값을 브라우저와 한 프레임씩 비교한다.

---

## 단계 4 - 상대가 스킬로 더 빨리 닿는 것을 수비기가 이해하게 한다

가장 우선순위가 높다.

현재 v2.1은 `canPlayerReachBallAt()`과 `interceptTrajectory()`로 상대가 공에 닿을 수 있는지 본다.
스킬이 이동/접촉 범위를 바꾸면 **여기에 스킬 사용 경로를 추가**해야 한다.

목표 결과:

```text
normal earliest contact = 8
skill earliest contact = 3
-> defense uses 3
```

상대 게이지가 충분하면 수비에서는 보수적으로 "상대가 최적으로 스킬을 쓸 수 있다"고 가정하는 편이 안전하다.

현재 선언된 `SKILL.reachActions()`는 v2.1 core에서 실제 호출되지 않으므로, 이것만 채우면 안 된다.

---

## 단계 5 - 우리도 이동 스킬로 새로운 공격 접촉을 찾는다

공의 미래 프레임마다 다음을 비교한다.

1. 일반 이동만으로 접촉 가능?
2. 스킬을 쓰면 더 이른 접촉 가능?
3. 더 이른/높은 접촉에서 기존 6개 power shot 중 무엇이 좋아지는가?
4. 게이지를 쓰는 가치가 있는가?

핵심 평가는 다음처럼 생각한다.

```text
스킬 사용 가치
= 스킬 접촉 후 최선 공격 점수
- 일반 접촉 후 최선 공격 점수
- 게이지 비용
- 실패/복구 위험
```

새 공격 평가함수를 만드는 것보다, 가능하면 **기존 `evaluateOutgoingTrajectory()`를 그대로 재사용**한다.

---

## 단계 6 - 게이지 사용 정책

처음에는 단순하고 안전하게 간다.

### 공격
아래 조건이 동시에 맞을 때 우선 사용:
- 스킬로 접촉이 의미 있게 빨라짐
- 결과 공격 점수가 일반 공격보다 명확히 좋음
- 자기 코트 실점 위험 없음
- 스킬 없이도 확정 득점이면 굳이 낭비하지 않음

### 수비
- 스킬 없이는 실점 확정에 가까움
- 스킬이면 살릴 수 있음
이라면 게이지 사용을 강하게 허용한다.

게이지가 랠리/세트 사이 유지되는 방식에 따라 비용 가중치는 나중에 조정한다.

---

## 단계 7 - 안전 실행기

스킬이 action hold 때문에 반복 발동되는지 반드시 확인한다.

특히 주의:
- skill + hit + x가 착지 후 dive로 변하지 않는가
- skill 버튼이 3프레임 held되어 게이지를 여러 번 소비하지 않는가
- state2에서 스킬이 재발동되는가
- 스킬 실패 후 stale input이 남는가

`executeSafely()`에 마지막 방어선을 둔다.

---

## 단계 8 - 최종 우선순위

시간이 부족하면 순서는 아래대로 한다.

1. snapshot/게이지 읽기
2. 정확한 스킬 발동 물리
3. 상대 skill contact를 defense에 반영
4. 우리 skill contact를 offense에 반영
5. 게이지 비용 최적화
6. 세밀한 튜닝

"우리 스킬을 멋지게 쓰는 것"보다 **상대가 스킬로 갑자기 일찍 때리는 것을 수비기가 아는 것**이 먼저다.
