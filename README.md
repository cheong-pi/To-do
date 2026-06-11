# 잊지 마

생활 루틴, 할일, 일정, 단어 학습, 타이머와 메모를 한 흐름에서 관리하는 개인 실행 관리 PWA입니다.

## 기술 구성

- Vite + React + TypeScript
- CSS Modules
- 브라우저 `localStorage` 우선 저장
- Google OAuth + Google Drive `appDataFolder` 선택 동기화
- Service Worker + Web App Manifest

Firebase와 Firestore는 현재 런타임에 사용하지 않습니다. 각 사용자의 데이터는 기본적으로 해당 브라우저에 저장되며, Google Drive를 연결하면 로그인한 사용자의 비공개 앱 폴더와 동기화됩니다.

## 실행

```powershell
npm install
npm run dev
```

프로덕션 빌드:

```powershell
npm run build
npm run preview
```

자동 회귀 테스트:

```powershell
npm test
```

현재 저장/복구, 일정 날짜 검증, 오늘 할일 정렬 규칙을 자동 테스트합니다. 기능 변경 뒤에는 `npm test`와 `npm run build`를 모두 통과시켜야 합니다.

## Google Drive 연결

`.env.example`을 `.env`로 복사하고 Google Cloud에서 발급한 웹 OAuth 클라이언트 ID를 입력합니다.

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

`.env`와 사용자 백업 JSON은 `.gitignore`에 포함되어 Git에 올라가지 않습니다. Google Cloud 설정 절차와 충돌 처리 방식은 [harness/google-drive-sync.md](harness/google-drive-sync.md)를 참고합니다.

## 데이터 안전

- 변경 즉시 브라우저 로컬 저장
- JSON 수동 백업과 복원
- 백업 복원 및 전체 삭제 직전 자동 복구 지점 생성
- Google Drive 최초 연결 충돌 시 원격/현재 데이터 선택
- Drive 데이터를 적용하기 전 로컬 복구본 생성
- 앱 렌더링 실패 시 데이터 삭제 없이 재시도 화면 표시

## PWA

설정 화면의 설치 준비 상태에서 보안 연결, 앱 정보, 아이콘, 오프라인 준비 여부를 확인할 수 있습니다. 실제 설치와 백그라운드 알림은 HTTPS 배포 환경의 Chrome/Edge 및 Android 기기에서 최종 확인해야 합니다.

## 개발 문서

현재 구현의 기준은 [harness/current-status.md](harness/current-status.md)입니다. 기존 Firebase 문서는 과거 설계 참고 자료이며 새 기능 구현 기준으로 사용하지 않습니다.
