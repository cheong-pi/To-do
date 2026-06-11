# 하네스 문서 사용 순서

새 작업을 시작할 때 아래 순서로 확인합니다.

1. `current-status.md`
2. `product-rules.md`
3. `google-drive-sync.md`
4. `automated-tests.md`
5. `verification-checklist.md`
6. 기능 변경과 관련된 나머지 문서

`firebase-data-plan.md`와 다른 문서 안의 Firebase 항목은 과거 설계 기록입니다. 현재 앱은 로컬 저장을 기본으로 하고 Google Drive `appDataFolder`를 선택 동기화 수단으로 사용합니다.

스키마를 변경할 때는 기존 로컬 데이터의 기본값과 마이그레이션 경로를 먼저 구현합니다. 사용자가 직접 요청하지 않은 데이터 삭제는 금지합니다.
