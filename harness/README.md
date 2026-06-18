# 하네스 문서 사용 순서

새 작업을 시작할 때 아래 순서로 확인합니다.

1. `current-status.md`
2. `product-rules.md`
3. `automated-tests.md`
4. `verification-checklist.md`
5. 기능 변경과 관련된 나머지 문서

`firebase-data-plan.md`, `google-drive-sync.md`와 다른 문서 안의 외부 동기화 항목은 과거 설계 기록입니다. 현재 앱은 각 기기의 브라우저 로컬 저장만 사용합니다.

스키마를 변경할 때는 기존 로컬 데이터의 기본값과 마이그레이션 경로를 먼저 구현합니다. 사용자가 직접 요청하지 않은 데이터 삭제는 금지합니다.
