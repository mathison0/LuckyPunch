# PikaPlanner v4 화면 증상별 파라미터 조정 가이드

대상 파일: `src/code-here/PikaPlanner_v4.js`

이 문서는 경기 화면에서 보이는 행동을 기준으로 `DEFAULT_CFG`의 어느 값을 어느 방향으로 조정할지 찾기 위한 현장용 가이드다. 승률이 낮다는 이유만으로 여러 값을 한꺼번에 바꾸지 말고, 같은 상대·진영·지연 조건에서 한 항목씩 비교한다.

## 1. 먼저 알아둘 좌표와 원칙

PikaPlanner v4는 어느 진영에서 뛰든 내부적으로 자신을 왼쪽 선수로 바꿔서 계산한다.

- 내부 x 범위는 `32`(자기 쪽 벽)에서 `184`(네트 앞)다.
- x 값을 높이면 실제 진영과 관계없이 **네트 쪽**으로 간다.
- x 값을 낮추면 실제 진영과 관계없이 **뒤쪽 벽**으로 간다.
- y는 `0`이 천장이고 `244`가 선수의 지면 위치다. y 값이 클수록 화면 아래쪽이다.
- `[A] DISCLOSED ENGINE CONSTANTS`의 `C`는 공개 엔진 수치다. 튜닝하지 않는다.
- 일반 전술 조정은 `[B] TUNABLE PARAMETERS`의 `DEFAULT_CFG`만 대상으로 한다.
- `ACTION_LATENCY`는 취향값이 아니라 실제 입력 반영 지연을 나타내는 모델값이다.

한 번에 한 파라미터만 바꾸고, 숫자 하나를 바꾼 뒤 반드시 양 진영을 모두 확인한다. 작은 표본에서 1승 더 나온 것보다 같은 실점 장면이 사라졌는지를 먼저 본다.

## 2. 안전한 실험 방법

원본을 직접 덮어쓰지 말고 실험 사본을 만든다.

```powershell
Copy-Item src/code-here/PikaPlanner_v4.js src/code-here/PikaPlanner_v4_tune.js
```

`PikaPlanner_v4_tune.js`의 `DEFAULT_CFG`에서 한 값만 바꾼 뒤, 최신 엔진을 동기화하고 같은 조건으로 비교한다.

```powershell
& "C:\Program Files\Git\bin\bash.exe" arena/sync-engine.sh

node arena/run.mjs PikaPlanner_v4.js      LuckyPunch_v16.js 2 1
node arena/run.mjs PikaPlanner_v4_tune.js LuckyPunch_v16.js 2 1

node arena/run.mjs LuckyPunch_v16.js PikaPlanner_v4.js      2 1
node arena/run.mjs LuckyPunch_v16.js PikaPlanner_v4_tune.js 2 1
```

명령 마지막의 `1`은 `applyLag=1`이다. 그 앞의 `2`는 세트 수다. 먼저 1~2세트로 실행 오류와 명백한 행동 악화를 확인하고, 좋아 보일 때만 표본을 늘린다.

> `arena/tune.mjs`는 `var NAME = 숫자` 형태의 구형 LuckyPunch 파라미터를 치환하도록 작성되어 있다. v4의 `DEFAULT_CFG` 객체를 자동으로 바꾸지 못하므로 v4 튜닝에는 그대로 사용하지 않는다.

## 3. 화면을 볼 때 기록할 것

실점 직전 3~5초를 보고 아래를 적는다.

1. 공이 누구 코트에 있었는가?
2. 봇은 지상, 점프, 파워 준비, 다이브 중 무엇이었는가?
3. 공을 못 건드렸는가, 건드렸지만 자기 코트에 남겼는가?
4. 네트 쪽과 뒤쪽 중 어느 공간이 비었는가?
5. 상대 타격 전부터 잘못 이동했는가, 타격 후에 늦었는가?
6. 같은 랠리 패턴이 반복됐는가?
7. `예외` 수가 0인가?

가능하면 `DEBUG: 1`, `DEBUG_EXPORT: 1`을 잠시 켠다. 콘솔의 `mode`를 보면 화면 행동을 다음과 같이 구분할 수 있다.

| mode | 화면에서의 의미 |
|---|---|
| `ANTICIPATE` | 상대가 곧 칠 수 있어서 미리 수비 위치를 잡는 중 |
| `DEFEND` | 공이 상대 코트로 갈 예정이라 수비 대기 위치를 선택 |
| `CLEAR` | 지상 몸받기로 상대 코트에 넘기려는 중 |
| `SELF_SET` | 자기 코트에 한 번 띄운 뒤 다음 공격을 준비 |
| `JUMP_INTERCEPT` | 점프를 시작해 공중 접촉을 노림 |
| `AIR_INTERCEPT` | 이미 공중에 있으며 접촉 위치를 다시 맞춤 |
| `AIR_CLEAR` | 터치 제한이 위험한 상태에서 공중 몸받기로 즉시 넘김 |
| `POWER` | 공중 파워히트 후보를 실행 |
| `DIVE` | 걷기로 닿지 않는 낮은 공에 다이브 |
| `RECEIVE_FALLBACK` | 계산된 지상 접촉 후보가 없어 낙하지점 근처로 이동 |

## 4. 가장 자주 보이는 증상별 빠른 처방

| 화면에서 보이는 증상 | 먼저 조정할 값 | 조정 방향 | 주의할 부작용 |
|---|---|---|---|
| 목표점 근처에서 좌우로 계속 떤다 | `MOVE_DEADBAND` | `4 → 5 → 6` | 너무 높으면 몇 px 모자란 위치에서 멈춘다 |
| 공 옆까지 왔는데 조금 모자라 접촉하지 못한다 | `MOVE_DEADBAND` | `4 → 3 → 2` | 낮추면 와리가리와 불필요한 방향 전환이 늘어난다 |
| 네트 앞 짧은 공격을 계속 놓친다 | `HOME_X`, `THREAT_HORIZON` | `HOME_X` 증가, `THREAT_HORIZON` 증가 | 뒤쪽 깊은 공과 계산 시간이 불리해질 수 있다 |
| 뒤쪽 깊은 공을 계속 놓친다 | `HOME_X`, `DEFENSE_MOVE_COST` | `HOME_X` 감소, `DEFENSE_MOVE_COST` 감소 | 네트 앞 공간이 커지고 선수가 자주 움직일 수 있다 |
| 상대가 치기 전에 한쪽으로 너무 일찍 쏠린다 | `THREAT_HORIZON`, `DEFENSE_CONTACT_WINDOW` | 둘 중 하나를 감소 | 너무 낮추면 상대 타격 후에야 반응한다 |
| 상대 타격 후 움직이기 시작해 항상 늦는다 | `ACTION_LATENCY`, `THREAT_HORIZON` | 실제 지연 확인 후 `ACTION_LATENCY` 일치, horizon 증가 | 잘못된 latency 값은 공격·수비 전체 예측을 동시에 망친다 |
| 평범한 낮은 공에도 점프한다 | `JUMP_MIN_VALUE_GAIN` | 증가 | 너무 높으면 좋은 공중 공격 기회를 포기한다 |
| 지상으로 받다가 강한 공중 공격 기회를 놓친다 | `JUMP_MIN_VALUE_GAIN` | 감소 | 점프 헛발질과 수비 공백이 늘어날 수 있다 |
| 점프는 했지만 공이 지나간 뒤 닿는다 | `JUMP_MAX_CONTACT`, `ACTION_LATENCY` | 먼저 latency 확인, 그다음 horizon 소폭 증가 | 무작정 늘리면 너무 먼 미래의 접촉에 일찍 점프한다 |
| 점프하자마자 공에 닿아 일반 몸받기가 된다 | `JUMP_POWER_MIN_CONTACT_FRAME` | 증가 | 빠른 공에 대한 점프 자체가 덜 선택될 수 있다 |
| 공중에서 파워 준비를 했는데 타격 입력이 풀린다 | `POWER_SEARCH_HOLD`, `LANDING_SAFETY_FRAMES` | hold 증가 또는 safety 감소 | 착지 직전 hit 유지로 다음 행동이 꼬일 수 있다 |
| 착지 직전 불필요한 hit 때문에 다이브·재점프가 나온다 | `LANDING_SAFETY_FRAMES` | 증가 | 너무 높으면 늦은 파워히트를 포기한다 |
| 걸어서 받을 수 있는 공에도 다이브한다 | `DIVE_HORIZON`, `DIVE_MIN_BALL_Y` | horizon 감소 또는 min Y 증가 | 긴급구조 가능한 공을 놓칠 수 있다 |
| 낮고 먼 공을 보면서도 다이브하지 않는다 | `DIVE_HORIZON`, `DIVE_MIN_BALL_Y` | horizon 증가 또는 min Y 감소 | 다이브 남발 가능 |
| 몸받기한 공이 자기 코트에 계속 남는다 | `RECEIVE_OFFSETS`, `SELF_SET_SCORE` | offsets의 큰 값 보강, self-set score 감소 | 공 가장자리를 받으려다 접촉 안정성이 낮아질 수 있다 |
| 필요 이상으로 셀프 세팅을 반복한다 | `SELF_SET_SCORE`, `SELF_SET_DEEP_BALL_X` | 둘 다 감소 방향 | 공격 준비 대신 급하게 넘기는 비율이 늘어난다 |
| 셀프 세팅이 네트에 너무 붙는다 | `SELF_SET_TARGET_X` | 감소 | 너무 낮추면 세팅이 뒤쪽에 떨어져 공격 전환이 느려진다 |
| 셀프 세팅이 너무 뒤에 떨어진다 | `SELF_SET_TARGET_X` | 증가 | 너무 높이면 네트 충돌·짧은 처리 위험이 커진다 |
| 공격이 항상 상대 정면으로 간다 | `SHOT_LANDING_DISTANCE_WEIGHT` | 증가 | 먼 곳만 노리다 느리거나 읽기 쉬운 궤적을 고를 수 있다 |
| 벽·네트 쿠션을 지나치게 고집한다 | 해당 `SHOT_*_EVENT_BONUS` | 감소 | 공격 패턴이 단순해질 수 있다 |
| 직선 공격만 반복해 읽힌다 | `SHOT_WALL_EVENT_BONUS`, `SHOT_NET_*_BONUS` | 한 항목만 소폭 증가 | 멋있어 보이지만 느리고 수비 가능한 샷을 고를 수 있다 |
| 높고 느린 공만 보내 상대가 쉽게 자리 잡는다 | `SHOT_TIME_WEIGHT` | 증가 | 너무 높으면 빠르지만 단순한 공격만 선택한다 |
| 빠른 공만 고집해 네트·자기 코트 실수가 늘어난다 | `SHOT_TIME_WEIGHT`, `DOWN_SMASH_MAX_NET_DISTANCE` | time weight 감소, down-smash 거리 감소 | 지나치면 공격 결정력이 낮아진다 |
| 상대가 받을 기회가 많은 공을 계속 선택한다 | `SHOT_INTERCEPT_OPTIONS_WEIGHT` | 증가 | 한 번의 접촉 가능성만 있어도 과도하게 회피할 수 있다 |
| 상대가 아주 늦게 겨우 받는 공을 좋은 공격으로 평가하지 않는다 | `SHOT_INTERCEPT_FRAME_WEIGHT` | 증가 | 착지까지 긴 공을 과대평가할 수 있다 |
| 수비 위치를 거의 바꾸지 않는다 | `DEFENSE_MOVE_COST` | 감소 | 상대 위협 예측이 흔들릴 때 선수도 크게 흔들린다 |
| 예측할 때마다 수비수가 과도하게 왕복한다 | `DEFENSE_MOVE_COST`, `MOVE_DEADBAND` | 둘 중 하나를 증가 | 반응성이 둔해질 수 있다 |
| 가능한 상대 공격 일부를 전혀 대비하지 않는다 | `DEFENSE_THREAT_LIMIT`, `DEFENSE_CONTACT_WINDOW` | 증가 | CPU 사용량과 과잉수비가 증가한다 |
| 긴 랠리가 같은 궤적으로 무한 반복된다 | `LONG_RALLY_BREAK_FRAME` | 감소 | 정상적인 긴 랠리에서도 일찍 대형이 흔들릴 수 있다 |
| 긴 랠리 탈출용 움직임이 너무 크다 | `LONG_RALLY_NUDGE_PX` | 감소 | 반복 궤도를 깨지 못할 수 있다 |
| 긴 랠리에서 좌우 이동 주기가 너무 빠르다 | `LONG_RALLY_NUDGE_PERIOD` | 증가 | 탈출까지 더 오래 걸린다 |
| 리드 중에도 위험한 공격을 계속한다 | `LEAD_SAFE`, `LEAD_RISK_SCALE` | threshold 감소 또는 scale 감소 | 지나치면 리드 후 공격력이 급감한다 |
| 뒤지고 있는데도 안전한 선택만 한다 | `TRAIL_AGGRO`, `TRAIL_RISK_SCALE` | threshold를 0 쪽으로, scale 증가 | 무리한 공격과 실수가 늘어난다 |

## 5. 파라미터별 상세 설명

### 5.1 제어와 탐색 범위

| 파라미터 | 기본값 | 값이 커지면 | 화면 판단과 권장 첫 조정 |
|---|---:|---|---|
| `ACTION_LATENCY` | 1 | 명령이 더 늦게 반영된다고 가정 | 실제 환경이 lag 2일 때만 `2`로 바꾼다. 스타일 튜닝에 사용하지 않는다 |
| `MOVE_DEADBAND` | 4 | 목표 주변에서 더 일찍 정지 | 떨림이면 `+1`, 몇 px 부족한 미스면 `-1` |
| `HOME_X` | 108 | 기본 수비 위치가 네트 쪽으로 이동 | 짧은 공 미스면 `+4`, 깊은 공 미스면 `-4` |
| `BALL_HORIZON` | 96 | 더 먼 미래와 긴 쿠션 궤적까지 계산 | 착지 예측이 중간에 끊기는 장면이면 `+16`; 느리면 `-16` |
| `CONTACT_HORIZON` | 48 | 지상 리시브 접촉 후보를 더 오래 탐색 | 멀리 오는 공이 계속 `RECEIVE_FALLBACK`이면 `+4~8` |
| `THREAT_HORIZON` | 18 | 상대가 칠 가능성을 더 일찍 탐색 | 타격 후 반응이면 `+2`; 헛예측 선이동이면 `-2` |
| `POWER_SEARCH_HOLD` | 8 | 파워 입력 후보를 더 오래 유지한 접촉까지 탐색 | 늦게 만나는 공을 치지 못하면 `+1`; 먼 미래 공격에 집착하면 `-1` |

`BALL_HORIZON`, `CONTACT_HORIZON`, `THREAT_HORIZON`, `POWER_SEARCH_HOLD`를 동시에 올리면 체감 프레임 드롭과 arena 실행시간 증가 원인을 구분하기 어렵다. 하나씩 올린다.

### 5.2 리시브와 셀프 세팅

| 파라미터 | 기본값 | 역할 | 조정 기준 |
|---|---:|---|---|
| `RECEIVE_OFFSETS` | `[8,12,18,24,30]` | 공보다 자기 선수를 몇 px 뒤쪽에 둘지 정하는 몸받기 후보 | 큰 offset은 상대 코트 방향 수평속도를 키운다. 자기 코트 잔류가 많으면 큰 후보를 보강하고, 가장자리 접촉 미스가 많으면 극단값을 줄인다 |
| `SELF_SET_TARGET_X` | 170 | 셀프 세팅의 원하는 착지 x | 증가하면 네트 쪽, 감소하면 뒤쪽 |
| `SELF_SET_DEEP_BALL_X` | 142 | 이 x보다 뒤쪽에서만 셀프 세팅 허용 | 증가하면 더 넓은 구역에서 세팅, 감소하면 아주 깊은 공에서만 세팅 |
| `SELF_SET_SCORE` | 92 | 셀프 세팅 후보의 기본 매력도 | 증가하면 세팅을 더 자주 선택, 감소하면 바로 넘기기를 선호 |

`RECEIVE_OFFSETS`는 배열 전체를 크게 바꾸기보다 후보 하나를 추가하거나 극단값 하나를 2~4px 조정한다. 예를 들어 `[8,12,18,24,30]`에서 직접 넘기는 힘이 부족해 보이면 먼저 마지막 값만 `32`로 시험한다.

### 5.3 점프 계획

| 파라미터 | 기본값 | 값이 커지면 | 권장 첫 조정 |
|---|---:|---|---|
| `JUMP_MAX_CONTACT` | 27 | 더 늦은 미래 접촉까지 점프 후보에 포함 | 늦은 공을 포기하면 `+2~3`; 너무 일찍 점프를 확정하면 `-2~3` |
| `JUMP_MIN_VALUE_GAIN` | 8 | 지상 리시브보다 훨씬 좋아야 점프 | 점프 남발이면 `+2`; 좋은 공격을 계속 지상 처리하면 `-2` |
| `JUMP_POWER_MIN_CONTACT_FRAME` | 4 | 충분히 늦은 접촉만 파워 가치로 평가 | 점프 직후 일반 몸받기가 많으면 `+1`; 빠른 공중 기회를 외면하면 `-1` |

점프 타이밍 미스는 먼저 `ACTION_LATENCY`가 실제 환경과 맞는지 확인한다. latency가 틀린 상태에서 점프 파라미터로 보정하면 한 상대에서는 좋아져도 다른 속도의 공에 무너진다.

### 5.4 다이브

| 파라미터 | 기본값 | 값이 커지면 | 권장 첫 조정 |
|---|---:|---|---|
| `DIVE_HORIZON` | 13 | 더 먼 미래의 낮은 공까지 다이브 검사 | 다이브가 늦으면 `+1~2`; 남발하면 `-1~2` |
| `DIVE_MIN_BALL_Y` | 166 | 화면 아래로 더 내려온 공에만 다이브 | 너무 이르면 `+4~8`; 너무 늦으면 `-4~8` |
| `DIVE_EXTRA_MARGIN` | 5 | 다이브 판정 거리 구간 자체가 바깥쪽으로 이동 | 가까운 공에 불필요하게 다이브하면 증가, 걷기 범위를 조금 넘는 공을 놓치면 감소. 반대로 아주 먼 공이 다이브 사거리 밖이면 증가가 도움이 될 수 있다 |

`DIVE_EXTRA_MARGIN`은 단순히 높을수록 다이브가 많아지는 값이 아니다. 다이브 허용 구간의 가까운 경계와 먼 경계를 둘 다 바꾸므로 `1~2`씩만 조정한다.

### 5.5 공격 궤적 평가

| 파라미터 | 기본값 | 높였을 때 선호하는 공격 |
|---|---:|---|
| `SHOT_UNRETURNABLE` | 520 | 시뮬레이터상 상대가 접촉할 수 없는 공격 |
| `SHOT_RETURN_BASE` | 170 | 상대가 받을 수 있어도 일단 넘기는 공격의 전체 가치 |
| `SHOT_INTERCEPT_FRAME_WEIGHT` | 7.5 | 상대의 최초 접촉이 늦은 공격 |
| `SHOT_INTERCEPT_OPTIONS_WEIGHT` | 1.6 | 상대의 접촉 가능 프레임 수가 적은 공격 |
| `SHOT_LANDING_DISTANCE_WEIGHT` | 0.22 | 상대 현재 위치에서 멀리 떨어지는 공격 |
| `SHOT_EDGE_WEIGHT` | 0.10 | 네트 근처 또는 상대 뒤쪽 벽 근처에 떨어지는 공격 |
| `SHOT_TIME_WEIGHT` | 0.42 | 빠르게 끝나는 공격 |
| `SHOT_WALL_EVENT_BONUS` | 5 | 벽 반사가 있는 공격 |
| `SHOT_NET_TOP_EVENT_BONUS` | 8 | 네트 상단 반사가 있는 공격 |
| `SHOT_NET_SIDE_EVENT_BONUS` | 10 | 네트 측면 반사가 있는 공격 |
| `SHOT_LATE_REVERSAL_BONUS` | 5 | 상대 접촉 직전 방향이 바뀌는 공격 |
| `SHOT_SELF_SIDE_PENALTY` | 20000 | 값이 클수록 자기 코트 착지를 강하게 금지 |

공격 가중치는 서로 경쟁한다. 화면에서 명확히 원하는 변화가 있을 때 `10~20%`만 조정한다. 이벤트 보너스는 `1~2`, 시간 가중치는 `0.05`, 거리 가중치는 `0.03~0.05`, 접촉 프레임 가중치는 `0.5~1.0`이 첫 실험 폭으로 적당하다.

`SHOT_SELF_SIDE_PENALTY`는 안전장치다. 자기 코트로 떨어지는 공격을 허용하려는 특별한 전술이 아니라면 낮추지 않는다. `SHOT_UNRETURNABLE`도 판정의 우선순위를 지키는 기준이므로 가장 나중에 건드린다.

### 5.6 수비 위치 선정

| 파라미터 | 기본값 | 값이 커지면 | 권장 첫 조정 |
|---|---:|---|---|
| `DEFENSE_X_STEP` | 8 | 후보 위치 간격이 거칠어지고 계산은 빨라짐 | 몇 px 차이로 반복 실점하면 `8 → 6 → 4`; CPU가 무거우면 증가 |
| `DEFENSE_MOVE_COST` | 0.30 | 현재 위치를 떠나는 것을 더 꺼림 | 과도한 왕복이면 `+0.05`; 수비 위치 고정이면 `-0.05` |
| `DEFENSE_NO_INTERCEPT_PENALTY` | 1000 | 받을 수 없다고 예측한 위협이 수비 선택을 더 강하게 지배 | 일부 필살 위협을 무시하면 증가, 불가능한 한 위협 때문에 다른 공까지 포기하면 감소 |
| `DEFENSE_THREAT_LIMIT` | 24 | 더 많은 상대 공격 후보를 유지 | 특정 방향 공격을 누락하면 `+4`; 느리거나 과잉수비면 `-4` |
| `DEFENSE_CONTACT_WINDOW` | 3 | 상대의 가장 이른 접촉 이후 더 많은 접촉 시점을 고려 | 상대의 늦은 타격 변화에 당하면 `+1`; 지나치게 보수적이면 `-1` |

`HOME_X`는 위협이 없을 때의 기본 위치이고, 실제 위협이 생성되면 `DEFENSE_*`가 위치를 결정한다. 화면에서 `DEFEND` 또는 `ANTICIPATE` 중인데 `HOME_X`만 바꿔도 변화가 거의 없다면 정상이다. 이때는 `DEFENSE_MOVE_COST`, `DEFENSE_CONTACT_WINDOW`, `THREAT_HORIZON`을 본다.

### 5.7 파워히트 실행 안전장치

| 파라미터 | 기본값 | 값이 커지면 | 권장 첫 조정 |
|---|---:|---|---|
| `POWER_NEAR_X` | 78 | 수평으로 더 먼 공에도 파워 후보 탐색 | 너무 늦게 준비하면 `+4~8`; 허공 hit가 많으면 감소 |
| `POWER_NEAR_Y` | 88 | 수직으로 더 먼 공에도 파워 후보 탐색 | 높은/낮은 공 준비가 늦으면 `+4~8`; 불필요한 준비가 많으면 감소 |
| `DOWN_SMASH_MAX_NET_DISTANCE` | 100 | 네트에서 더 먼 위치에서도 아래 방향 파워를 허용 | 아래찍기를 더 쓰려면 `+8~12`; 자기 코트 낙하·네트 실패가 늘면 감소 |
| `LANDING_SAFETY_FRAMES` | 3 | 착지 전 더 일찍 hit를 해제 | 착지 직전 입력 꼬임이면 `+1`; 늦은 파워를 놓치면 `-1` |

`POWER_NEAR_X/Y`는 공격 성공 점수가 아니라 계산을 시작할지 결정하는 문턱이다. 크게 올리면 실제로 닿지 못할 먼 공에 대해 비싼 후보 탐색을 반복할 수 있다.

### 5.8 장기 랠리 반복 탈출

| 파라미터 | 기본값 | 역할과 조정 |
|---|---:|---|
| `LONG_RALLY_BREAK_FRAME` | 900 | 이 프레임 이후에만 반복 탈출 움직임 허용. 25 FPS 기준 약 36초. 반복이 너무 오래 지속되면 감소 |
| `LONG_RALLY_NUDGE_PERIOD` | 97 | 뒤/앞/중립 위치 변화의 유지 주기. 이동이 너무 자주 바뀌면 증가 |
| `LONG_RALLY_NUDGE_PX` | 6 | 기본 수비 위치에서 흔드는 거리. 반복을 못 깨면 증가, 정상 수비를 해치면 감소 |
| `LONG_RALLY_MIN_THREAT_LEAD` | 10 | 상대의 다음 접촉이 이보다 가까우면 nudge 금지. 증가하면 더 안전하고 드물게 작동 |

이 네 값은 일반 랠리 성능을 높이는 튜닝값이 아니라 결정론적 반복 궤도 탈출용이다. 30초 이전의 실점에는 영향을 주지 않는 것이 정상이며, 짧은 랠리 문제를 해결하는 데 사용하지 않는다.

### 5.9 점수차에 따른 위험도

| 파라미터 | 기본값 | 의미 |
|---|---:|---|
| `LEAD_SAFE` | 2 | 이 점수차 이상 리드하면 `LEAD_RISK_SCALE` 적용 |
| `TRAIL_AGGRO` | -2 | 이 점수차 이하 열세면 `TRAIL_RISK_SCALE` 적용 |
| `LEAD_RISK_SCALE` | 0.92 | 리드 중 공격 궤적 점수 배율. 낮을수록 공격 가치가 줄어듦 |
| `TRAIL_RISK_SCALE` | 1.08 | 열세 중 공격 궤적 점수 배율. 높을수록 공격 가치가 커짐 |

주의할 점은 이 배율이 ‘안전한 샷/위험한 샷’을 직접 구분하는 스위치가 아니라 공격 궤적 점수 전체를 조정한다는 것이다. 점수차별 행동이 정말 화면에서 달라져야 하는 경우에만 `0.02~0.04` 단위로 조정한다.

### 5.10 디버그

| 파라미터 | 기본값 | 용도 |
|---|---:|---|
| `DEBUG` | 0 | `1`이면 주기적으로 현재 mode, 위치, 공, action 출력 |
| `DEBUG_EVERY` | 60 | 몇 번의 `decide()`마다 로그를 남길지 결정 |
| `DEBUG_EXPORT` | 0 | `1`이면 `globalThis.__PIKA_DEBUG_STATE__`에 최신 판단 공개 |

디버그를 켠 파일은 콘솔 출력 비용과 로그 노이즈가 생긴다. 원인 확인이 끝나면 제출본에서는 다시 0으로 돌린다.

## 6. 서로 헷갈리기 쉬운 조합

### 선수가 늦게 도착한다

다음 순서로 본다.

1. `ACTION_LATENCY`가 실제 환경과 맞는가?
2. 목표 근처에서 멈춘다면 `MOVE_DEADBAND`가 너무 큰가?
3. 애초에 늦게 움직이기 시작하면 `THREAT_HORIZON` 또는 `CONTACT_HORIZON`이 짧은가?
4. 수비 중 현재 위치를 고집하면 `DEFENSE_MOVE_COST`가 큰가?
5. 정말 걷기로 불가능한 공이면 `DIVE_*` 문제인가?

### 점프 타이밍이 이상하다

1. `ACTION_LATENCY` 확인
2. 점프 자체가 너무 잦으면 `JUMP_MIN_VALUE_GAIN`
3. 너무 먼 미래 접촉에 점프하면 `JUMP_MAX_CONTACT`
4. 점프 직후 몸받기만 나오면 `JUMP_POWER_MIN_CONTACT_FRAME`
5. 공중에서 늦게 파워를 못 켜면 `POWER_SEARCH_HOLD`와 `LANDING_SAFETY_FRAMES`

### 수비 위치가 이상하다

- 공이 상대 코트에 있는데 미리 이동한다면 `ANTICIPATE` 또는 `DEFEND`가 정상 동작 중일 수 있다.
- 위협이 없을 때 위치만 이상하면 `HOME_X`를 본다.
- 위협이 있을 때 한쪽으로 과도하게 쏠리면 `DEFENSE_CONTACT_WINDOW`, `DEFENSE_THREAT_LIMIT`, `DEFENSE_MOVE_COST`를 본다.
- 상대가 친 뒤에만 늦게 움직이면 `THREAT_HORIZON`과 latency를 본다.

### 공격 방향이 마음에 들지 않는다

공격의 최종 방향만 보고 `RECEIVE_OFFSETS`와 `SHOT_*`를 동시에 바꾸지 않는다.

- 지상 몸받기 직후 방향 문제: `RECEIVE_OFFSETS`
- 파워히트 후보 선택 문제: `SHOT_*` 가중치
- 아래찍기 사용 위치 문제: `DOWN_SMASH_MAX_NET_DISTANCE`
- 셀프 세팅 빈도·위치 문제: `SELF_SET_*`

## 7. 권장 튜닝 순서

1. `ACTION_LATENCY`를 실제 환경과 일치시킨다.
2. `MOVE_DEADBAND`, `HOME_X`처럼 화면에서 바로 확인되는 위치값을 조정한다.
3. 리시브 문제는 `CONTACT_HORIZON`과 `RECEIVE_OFFSETS`를 본다.
4. 점프 문제는 `JUMP_MIN_VALUE_GAIN`부터 본다.
5. 수비 선점 문제는 `THREAT_HORIZON`, `DEFENSE_MOVE_COST`, `DEFENSE_CONTACT_WINDOW` 순으로 본다.
6. 다이브는 실제로 걷기 불가능한 공만 따로 모아 조정한다.
7. 공격 가중치는 수비와 접촉 안정성이 확보된 뒤 한 항목씩 조정한다.
8. 장기 랠리 값은 실제 반복 궤도가 확인됐을 때만 바꾼다.
9. 마지막에 양 진영, lag 1, 여러 상대에서 회귀 테스트한다.

## 8. 변경 기록 템플릿

```markdown
### 실험 이름

- 대상 파일: PikaPlanner_v4_tune.js
- 상대 / 진영 / lag:
- 화면 증상:
- 변경값: MOVE_DEADBAND 4 → 5
- 예상 변화:
- 실제 변화:
- 득실 / 예외:
- 반대 진영 결과:
- 유지 또는 폐기:
```

좋은 변경은 한 장면을 고치는 데 그치지 않고 다음 조건을 만족해야 한다.

- 같은 실점 패턴이 줄어든다.
- 반대 진영에서도 같은 원리로 작동한다.
- `예외 0/0`을 유지한다.
- 평균 프레임이나 실행시간이 비정상적으로 증가하지 않는다.
- 기본 AI뿐 아니라 최소 한 개의 강한 상대에서도 기존 장점이 유지된다.

