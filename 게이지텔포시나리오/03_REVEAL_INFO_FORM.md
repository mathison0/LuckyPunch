# 3. 당일 스킬 공개 정보 기록지

아래를 채워서 그대로 전달하면 된다.

## A. Snapshot
- 새 필드 전체:
- self 관련:
- opp 관련:
- meta 관련:
- config 관련:
- 게이지 최소/최대:
- 시작 게이지:
- 상대 게이지 관측 가능: YES / NO

## B. 게이지
- 충전 조건:
- 프레임당 증가량:
- 접촉 시 증가량:
- 득점/실점 시 변화:
- 랠리 종료 후 유지:
- 세트 종료 후 유지:
- 사용 비용:
- 여러 단계 사용 가능 여부:

## C. 발동 입력
- 새 action 필드가 있는가:
- 정확한 반환 예시:
- 기존 x/y/hit과 동시 사용 가능:
- held action에서 반복 발동 여부:
- 발동 실패 시 게이지 소비 여부:

## D. 이동/텔레포트 물리
- 종류: DASH / AIR DASH / SUPER JUMP / TELEPORT / OTHER
- 발동 가능한 state:
- 발동 즉시 이동 거리:
- 이후 지속 프레임:
- 프레임별 이동량:
- 방향 전환 가능:
- 공중 사용 가능:
- 네트/벽 통과 가능:
- 플레이어 경계 clamp 규칙:
- 발동 중 hitbox:
- 발동 중 ball collision:
- 충돌 시 power hit 여부:
- 발동 후 state:

## E. 정확한 프레임 순서
가능하면 공개 소스 함수 순서를 붙여넣는다.

- input read
- skill activation
- ball world physics
- player movement
- gravity
- player state update
- ball-player collision
- gauge update

실제 순서:

## F. 10개 실측
각 실험마다 snapshot 전/후와 프레임별 x,y,state,gauge를 기록.

1. 지상 정지 상태에서 사용
2. 지상 이동 중 사용
3. 점프 상승 중 사용
4. 점프 정점 근처 사용
5. 하강 중 사용
6. 공과 겹치기 1프레임 전 사용
7. 네트 바로 앞 사용
8. 벽/코트 끝 근처 사용
9. 게이지 부족 상태 사용
10. 버튼을 3프레임 held한 상태 확인
