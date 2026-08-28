# 오프라인 대전 하네스

브라우저 없이 실제 게임 엔진(`physics.js`)을 그대로 돌려서 봇을 수백 세트 붙인다.
브라우저로 한 세트 돌리는 데 1분 걸리는 걸 여기선 1초에 끝낸다.

```bash
cd arena && bash sync-engine.sh                        # 엔진 사본 갱신 (최초 1회 / 엔진 변경 시)

node bench.mjs LuckyPunch_v3.js 10                     # 종합: 상대·양진영·지연 전 조합
node run.mjs  LuckyPunch_v3.js ai 20 1                 # 단일 매치업
node tune.mjs LuckyPunch_v3.js CONTACT_Y_TOL 14,20,26  # 파라미터 스윕 (미러 자기대전)
node debug.mjs LuckyPunch_v3.js 1 right                # 한 랠리 프레임 단위 추적
```

## 하네스가 재현하는 것

- `botInput.js`의 tick 그룹(3프레임)과 Worker 왕복 지연(`applyLag`)
- **랠리 시작 전 정지 구간** — 득점 후 35프레임, 첫 랠리 71프레임 동안
  physics는 멈춰 있는데 `decide`는 계속 호출된다. 이걸 빼먹으면 오프라인
  결과가 브라우저와 정반대로 나온다 (실제로 겪었다).
- 5회 연속 접촉 규칙 (`rules/touchLimit.js`)
- 내장 AI (엔진의 `letComputerDecideUserInput`)

## 주의

- 봇끼리 붙이면 **결정론적**이라 세트를 아무리 늘려도 표본이 1개다.
  `jitter` 옵션(시작 위치 흔들기)을 켜야 통계가 의미 있다.
- 미러 벤치마크에서 같은 파일끼리는 항상 정확히 50%가 나온다 (구조상 당연).
