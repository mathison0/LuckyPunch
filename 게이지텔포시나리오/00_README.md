# PikaPlanner v2.1 - 게이지 + 대시/텔레포트 가설 준비 패키지

목적은 실제 스킬을 미리 맞혀서 하드코딩하는 것이 아니다.

1. `게이지 + 이동/접촉 능력 강화`가 맞을 경우 현장에서 빠르게 실제 구현으로 연결한다.
2. 예측이 빗나가도, 새 스킬이 기존 게임의 어떤 규칙을 바꾸는지 분류하고 같은 순서로 적용한다.
3. 현재 v2.1 제출 후보는 그대로 보존한다.

## 파일
- `PikaPlanner_v2_1_BASE_UNTOUCHED.js`: 현재 v2.1 원본 보존본.
- `PikaPlanner_v2_1_mobility_scaffold.js`: 행동 변화가 없는 no-op 준비 브랜치. 수정 위치와 로그 필드만 추가.
- `01_HYPOTHESIS_AND_REASONING.md`: 왜 게이지 + 이동기 가설을 세웠는지, 무엇이 추측인지.
- `02_MATCHDAY_PATCH_ROUTE.md`: 실제 공개 후 고치는 순서.
- `03_REVEAL_INFO_FORM.md`: 당일 스킬 문서를 보고 채울 정보표.
- `04_TEST_AND_LOG_PLAN.md`: 브라우저 측정/회귀 테스트/로그 체크리스트.
- `PikaPlanner_Gauge_Mobility_Field_Guide.pdf`: 위 내용을 읽기 쉽게 정리한 PDF.

## 가장 중요한 원칙
실제 스킬 공개 전에는 `BASE_UNTOUCHED.js`를 제출 기준으로 유지한다.
`mobility_scaffold.js`는 예측용 준비 브랜치일 뿐이다.

실제 스킬 공개 후에는 설명 문구만으로 추측하지 말고, 가능하면 공개 소스와 브라우저 프레임 로그로 **발동 순서와 수치**를 먼저 확정한다.
