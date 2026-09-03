# Skill-Day Patch Template

이 문서는 스킬 공개 직후 추측을 줄이기 위한 빈 양식이다.

## A. 공개 사실
- 추가 snapshot field:
- 새 action/입력:
- gauge/cooldown:
- player state 변화:
- ball physics 변화:
- collision 변화:
- frame 처리 순서:
- 좌/우 비대칭 여부:

## B. 분류
- [ ] 정보만 추가
- [ ] 새 tactical action
- [ ] emergency action
- [ ] ball physics
- [ ] player physics
- [ ] reach/hitbox
- [ ] collision/output
- [ ] resource management

## C. 수정할 함수
- `SKILL.read`:
- `SKILL.transformContext`:
- `SKILL.ballFrameHook`:
- `SKILL.extraActions`:
- `SKILL.evaluate`:
- `SKILL.emergencyOverride`:
- core 추가 수정이 필요한가? 이유:

### reach/hitbox라면 반드시
- `canPlayerReachBallAt` 상대 모델 패치:
- `findBestGroundReceive`/`firstGroundContactForTarget` self 모델 패치:
- `findJumpTakeoff`/`findAirborneIntercept` 패치:
- 실제 action executor 패치:

### player state/physics라면 반드시
- `estimatePlayerVy`
- `neutralVerticalTimeline`
- `stepSelfExact`
- `framesUntilLanding`

### collision/output라면 반드시
- `ordinaryCollisionFrom`
- opponent threat generation
- power candidate simulation

## D. 신규 invariant
- 스킬 사용 후 stale held input 위험:
- gauge를 0으로 만들면 안 되는 상황:
- 스킬이 possession/touch count에 미치는 영향:
- 좌우 대칭 여부:

## E. 테스트 결과
| Test | LEFT | RIGHT | touch-limit | self-score | 비고 |
|---|---:|---:|---:|---:|---|
| Opp A latency1 | | | | | |
| Opp B latency1 | | | | | |
| Opp A latency2 | | | | | |
| Opp B latency2 | | | | | |
| v2.1 baseline direct | | | | | |
