# 4. 테스트와 로그 계획

## 0. 첫 번째 회귀 테스트 - 스킬 비활성 상태
새 브랜치에서 스킬이 비활성일 때 기존 v2.1과 행동이 완전히 같아야 한다.

권장:
- snapshot 1,000개 이상
- LEFT / RIGHT 모두
- 동일 입력 -> 동일 `{x,y,hit}`

## 1. 브라우저 단위 테스트

### Gauge
- 증가/감소 수치 정확성
- 랠리 시작/종료 reset 여부
- 세트 유지 여부

### Dash / teleport
- 발동 프레임
- 실제 x/y 변화
- state 변화
- collision 가능 프레임
- action hold 재발동 여부

### Symmetry
LEFT/RIGHT에서 동일한 규칙인지 확인. 특히 네트 x=216 경계처럼 equality branch가 있을 수 있으므로 소스 그대로 확인.

## 2. Planner 테스트

### 상대 위협
동일 공 상태에서:
- 상대 gauge 없음 -> normal contact T
- 상대 gauge 있음 -> skill contact T'
- T' < T가 정확히 계산되는지

### 우리 공격
- skill 없이 최선 공격 score
- skill로 더 이른 contact 후 최선 공격 score
- 실제 선택이 두 점수 차이를 반영하는지

### 게이지 절약
- 스킬 없이 확정 득점인 상황에서 낭비하지 않는지
- 스킬이 없으면 실점, 있으면 세이브 가능한 상황에서 사용하는지

## 3. 반드시 남길 디버그 로그

```text
snapshot tick
selfGauge / oppGauge
selfSkillReady / oppSkillReady
normalEarliestContact
skillEarliestContact
skillContactGain
selectedPlan
selectedSkillAction
skillActivationFrame
predictedPlayerX/Y at contact
predictedBallX/Y at contact
predictedGaugeAfter
actual contact frame (replay analysis)
score before/after
```

## 4. A/B 대전
기존 두 상대 코드와 반드시 다시 테스트.

- v2.1 base vs 상대1
- skill branch vs 상대1
- 좌우 교대
- v2.1 base vs 상대2
- skill branch vs 상대2
- 좌우 교대

가능하면 동일 seed를 pairing해서 비교한다.

지표:
- 승률
- 평균 점수차
- 0~2점 대패 비율
- 5터치 실점
- self-score
- 스킬 사용 횟수
- 스킬 사용 후 득점률
- 스킬을 안 써서 놓친 점수
- 스킬 사용 때문에 생긴 실점

## 5. 현장 승인 기준
최종 제출 후보는 최소한:
- 스킬 OFF에서 기존 v2.1 회귀 없음
- action contract 오류 0
- gauge underflow/중복 소비 0
- 좌우 모두 정상
- self-score 증가 없음
- 5터치 tail failure 증가 없음
- 두 상대 코드 중 최소 하나에만 과적합된 변화가 아님
