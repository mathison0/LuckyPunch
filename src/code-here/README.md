# PikaPlanner bot package

이 패키지는 공개된 대회 엔진 코드를 바탕으로 만든 세 가지를 함께 제공합니다.

1. `PikaPlanner_tuned_v1.js` - 바로 제출 후보로 쓸 수 있는 튜닝 버전
2. `PikaPlanner_v1.js` - 튜닝값이 비어 있는 개발용 원본
3. `tools/` - 독립 실행형 물리 시뮬레이터, 대전기, 튜너, probe, benchmark

> 중요: `tools/sim_engine.mjs`는 공개된 물리/입력 규약을 최대한 그대로 옮긴 **오프라인 근사 테스트베드**입니다. 브라우저 Worker의 실제 스케줄링, 렌더링 지연, 대회 당일 비공개 스킬까지 보증하는 공식 엔진은 아닙니다. 최종 판정은 반드시 실제 `leonyi-volleyball` Chrome 환경에서 다시 확인하세요.

## 1. 가장 빠르게 사용하기

대회 저장소에서:

```bash
cp /path/to/PikaPlanner_tuned_v1.js src/code-here/MyTeam_v1.js
npm start
```

Chrome에서 게임 시작 -> 봇 설정 -> `MyTeam v1 (JS)`를 선택해 실제 엔진에서 확인합니다.

추천 순서:

- LEFT bot vs 기본 AI
- RIGHT bot vs 기본 AI
- bot vs `Positioning` 예제
- 같은 봇 LEFT/RIGHT self-play
- 일부러 Chrome DevTools를 열고 CPU throttling을 걸어 입력 지연에 민감한지 확인

## 2. 파일 구조

```text
pikachu_bot_package/
├─ PikaPlanner_v1.js          개발용 기본 버전
├─ PikaPlanner_tuned_v1.js    현재 추천 제출 후보
├─ README.md
├─ SKILL_DAY_CHECKLIST.md
└─ tools/
   ├─ sim_engine.mjs          공개 물리 + bot tick 근사 시뮬레이터
   ├─ run_series.mjs          여러 세트 자동 대전
   ├─ tune.mjs                파라미터 탐색
   ├─ export_tuned_bot.mjs    best_config -> 제출용 JS에 삽입
   ├─ probe.mjs               6종 파워히트 궤적 빠른 조사
   ├─ bench.mjs               decide() 속도/반환값 검사
   ├─ verify.mjs              짧은 회귀 테스트
   ├─ BaselinePositioning_v1.js
   ├─ BaselineAggressive_v1.js
   └─ best_config.json        이번에 실제 탐색해 얻은 설정
```

## 3. 기본 검증

Node.js 18+이면 추가 패키지 설치가 필요 없습니다.

```bash
cd pikachu_bot_package
node tools/verify.mjs
node tools/bench.mjs
```

`verify.mjs`는 반환 contract를 검사하고 두 baseline과 짧은 대전을 합니다.

`bench.mjs`는 평균 `decide()` 실행시간을 측정합니다. 이 문서를 만들 때 제공된 튜닝 봇은 오프라인 Node benchmark에서 20,000회 호출 평균 약 `0.06 ms/call` 수준이었습니다. 브라우저 Worker/Pyodide와는 환경이 다르므로 절대값이 아니라 regression 지표로 사용하세요.

## 4. 여러 경기 자동 대전

```bash
node tools/run_series.mjs \
  --left ./PikaPlanner_tuned_v1.js \
  --right ./tools/BaselinePositioning_v1.js \
  --matches 50 \
  --seed 100 \
  --latency 1,2,3
```

`--latency 1,2,3`은 봇 응답이 snapshot 생성 후 1/2/3 engine frame 뒤 적용되는 경우를 섞어 테스트합니다. 실제 Chrome의 응답 시점이 고정 120ms가 아니기 때문에, 한 latency에서만 잘 되는 봇보다 세 값에 모두 버티는 봇을 선호하세요.

### 좌우를 반드시 바꿔서 다시 돌리기

공개 엔진 주석 자체가 벽 대칭 수정 뒤에도 잔여 side bias를 보고하고 있습니다. 따라서 한 방향 결과만 믿으면 안 됩니다.

```bash
node tools/run_series.mjs --left ./tools/BaselinePositioning_v1.js --right ./PikaPlanner_tuned_v1.js --matches 50
```

## 5. 파라미터 튜닝

```bash
node tools/tune.mjs \
  --bot ./PikaPlanner_v1.js \
  --generations 8 \
  --population 14 \
  --matches 10 \
  --seed 20260901 \
  --out ./tools/best_config.json
```

튜너는 다음을 일부 변경합니다.

- 이동 deadband / 대기 위치
- 몸 리시브 offset
- 점프 탐색 horizon
- power-hit arm 거리
- down-smash 허용 네트 거리
- 다이빙 horizon
- shot 평가 가중치

튜닝 결과를 제출용 파일에 넣기:

```bash
node tools/export_tuned_bot.mjs \
  --bot ./PikaPlanner_v1.js \
  --config ./tools/best_config.json \
  --out ./PikaPlanner_tuned_v2.js
```

그 뒤 반드시 실제 Chrome 게임에서 회귀 테스트합니다.

### 튜닝 결과를 과신하지 말 것

현재 baseline 두 개만 최적화하면 그 두 봇에 과적합될 수 있습니다. 팀에서 새 opponent 파일을 만들면 `tools/tune.mjs`의 `opponents` 배열에 추가하세요. 가장 좋은 구성은 다음처럼 서로 다른 성향 4~8개입니다.

- 아주 안전한 수비형
- 네트에 붙는 공격형
- 깊은 공을 선호하는 공격형
- 랜덤 믹스형
- 이전 버전 우리 봇
- 사람이 직접 발견한 exploit을 코드로 옮긴 adversarial bot

## 6. 파워히트 probe

특정 접촉 상태에서 6개 power-hit family의 예상 착지점을 빠르게 봅니다.

```bash
node tools/probe.mjs x=170 y=125 vy=11
```

출력 예:

```text
FAST DOWN -> landing=..., frames=...
FAST FLAT -> ...
...
```

대회 당일 스킬이 공의 속도/중력을 바꾸면 `probe.mjs`와 봇의 `[C] SKILL ADAPTER`/`simulateBallHook()`를 같이 수정해서 새 물리를 먼저 계측하세요.

## 7. 봇 내부에서 어디를 수정해야 하나

`PikaPlanner_v1.js`는 영역을 의도적으로 나눴습니다.

- `[A] DISCLOSED ENGINE CONSTANTS`: 기본 물리가 바뀌지 않는 한 수정 금지
- `[B] TUNABLE PARAMETERS`: 평소 튜닝 영역
- `[C] SKILL ADAPTER`: **대회 당일 1순위 수정 영역**
- `[E] EXACT PHYSICS SIMULATOR`: 스킬이 물리를 바꾸는 경우만 수정
- `[F] REACHABILITY`: dash/teleport/추가점프 등 이동 스킬일 때 수정
- `[I] TACTICAL PLANNER`: 가급적 당일 수정하지 않음
- `[J] ACTION EXECUTOR / SAFETY`: 입력 semantics 자체가 달라진 경우만 수정

핵심 원칙은 **스킬 때문에 core planner를 갈아엎지 않는 것**입니다.

## 8. 현재 봇이 하는 일

아주 짧게 요약하면:

1. RIGHT로 배치돼도 내부에서는 항상 LEFT처럼 좌표를 뒤집음
2. 현재 공을 공개 physics로 앞으로 굴려봄
3. 땅에서 안전하게 받을 위치와 지금 점프했을 때 생기는 접촉 window를 비교
4. 깊은 공은 한 번 self-set으로 네트 근처 공격권을 만드는 선택지가 있음
5. 공중에서는 `x={0,nonzero} × y={up,flat,down}` 후보를 실제로 시뮬레이션
6. 자기 코트에 박히는 스매시는 제거하고, 상대가 시간 안에 가기 어려운 공을 선호
7. 상대가 막 파워히트할 상황이면 현재 landingX를 쫓지 않고 가능한 공격 착지점 묶음의 중앙을 방어
8. 일반 이동으로 못 살리고 dive로만 가능한 낮은 공에 한해 dive
9. 마지막 safety gate가 stale `hit=1` 때문에 착지 직후 dive가 나가는 등의 사고를 막음

## 9. 현재 오프라인 실험 결과

`PikaPlanner_tuned_v1.js`는 이 패키지의 자체 simulator에서 latency 1/2/3 frame을 섞어 시험했습니다.

- 수비형 baseline을 상대로 LEFT 배치 30세트: 26승 3패 1무
- 공격형 baseline을 상대로 LEFT 배치 30세트: 22승 8패
- 반대 side에서도 별도 검증을 수행했으며 둘 모두 우세한 표본이 나왔음
- `decide()` 20,000회 Node benchmark: 평균 약 0.062ms, 잘못된 반환 0회

이 숫자는 **실제 대회 승률 예측이 아닙니다.** 자체 simulator 및 만든 baseline에 대한 regression 결과일 뿐이며, 실제 Chrome 엔진에서 반드시 재검증해야 합니다.

## 10. 실제 개발 루프 추천

```text
아이디어 1개만 변경
   -> node tools/verify.mjs
   -> latency 1/2/3 series
   -> LEFT/RIGHT swap
   -> 실제 Chrome에서 bot-vs-bot
   -> 결과 기록
   -> 다음 변경
```

한 번에 여러 조건을 바꾸면 무엇 때문에 좋아졌는지 알 수 없습니다. 버전 파일을 `MyTeam_v10.js`, `v11.js` 식으로 남겨 A/B 하세요.

## 11. 알려진 한계

- 공개되지 않은 당일 skill은 아직 no-op adapter 상태입니다.
- 브라우저 Worker 지연은 기기/Chrome scheduling에 따라 변동되므로 simulator의 `latencyFrames`는 근사입니다.
- snapshot에는 player yVelocity, state-2 내부 delay, state-4 남은 recovery frame이 없어서 봇은 이를 추정합니다.
- opponent reachability 평가는 full minimax가 아니라 짧은 model-based heuristic입니다.
- self-set touch tracking은 snapshot만으로 근사하므로 core safety는 5-touch 직전까지 공격을 늘리는 방식에 의존하지 않습니다.

이 한계 때문에 “offline simulator에서 가장 높은 승률”보다 **실제 대회 페이지에서 안정적인 버전**을 최종 제출하는 것이 맞습니다.
