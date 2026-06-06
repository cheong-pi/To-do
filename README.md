# 잊지 마

습관을 기르고 오늘 할 일을 잊지 않게 돕는 개인 실행 관리 앱입니다.

기본 동작은 캘린더와 비슷하지만, 날짜보다 오늘 실행할 일을 우선해서 보여주고 영어 단어 복습을 함께 제공합니다.

## 기술 스택

- Vite
- React
- TypeScript
- CSS Modules
- Google OAuth
- Google Drive `appDataFolder`

## 개발 실행

Node.js와 npm이 필요합니다.

의존성 설치:

```powershell
npm install
```

개발 서버:

```powershell
npm run dev
```

빌드:

```powershell
npm run build
```

## 현재 구현 범위

- React 앱 구조
- 오늘 화면 v0
- `#FFE680` 메인 컬러
- 오늘 할 일 최대 15개 정렬 규칙
- 시작, 미루기, 취소 상태 변경
- 진행률 `- / 숫자 입력 / +` UI
- 단어 20개 학습 흐름을 위한 화면 자리
- 뽀모도로 마지막 설정 화면 자리

## Google Drive 동기화

Google Cloud에서 Drive API와 웹 OAuth 클라이언트를 설정한 후 `.env.example`을 복사해 `.env`에 클라이언트 ID를 입력합니다.

```env
VITE_GOOGLE_CLIENT_ID=발급받은_클라이언트_ID
```

사용자 데이터는 각 사용자의 Google Drive 앱 전용 숨김 폴더에 저장됩니다. 자세한 설정은 `harness/google-drive-sync.md`를 참고합니다.

```powershell
Copy-Item .env.example .env
```

Firestore 보안 규칙 초안은 `firestore.rules`에 있습니다.

## 개발 기준

개발 전 `/harness` 문서를 먼저 확인합니다.

- `/harness/app-goal.md`
- `/harness/product-rules.md`
- `/harness/data-schema.md`
- `/harness/agent-tasks.md`
- `/harness/verification-checklist.md`
- `/harness/safety-rules.md`
