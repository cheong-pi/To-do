# 잊지 마

생활 루틴, 할일, 일정, 단어 학습, 타이머와 메모를 한 흐름에서 관리하는 개인 실행 관리 PWA입니다.

설정에서 단어 학습, 타이머, 메모 메뉴를 각각 켜거나 숨길 수 있습니다. 메뉴를 숨겨도 기존 데이터는 삭제되지 않습니다.

## 기술 구성

- Vite + React + TypeScript
- CSS Modules
- 브라우저 `localStorage` 우선 저장
- 브라우저 `localStorage` 개인 저장
- Service Worker + Web App Manifest

Firebase, Firestore, Google Drive 동기화는 사용하지 않습니다. 각 사용자의 데이터는 앱을 사용하는 기기의 브라우저에만 저장됩니다.

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

## 데이터 안전

- 변경 즉시 브라우저 로컬 저장
- JSON 수동 백업과 복원
- 백업 복원 및 전체 삭제 직전 자동 복구 지점 생성
- 앱 렌더링 실패 시 데이터 삭제 없이 재시도 화면 표시

브라우저 데이터 삭제, 기기 변경, 다른 브라우저 사용 전에는 설정에서 JSON 백업을 내려받아야 합니다. 사용자 백업 JSON은 `.gitignore`에 포함되어 Git에 올라가지 않습니다.

## PWA

설정 화면의 설치 준비 상태에서 보안 연결, 앱 정보, 아이콘, 오프라인 준비 여부를 확인할 수 있습니다. 실제 설치와 백그라운드 알림은 HTTPS 배포 환경의 Chrome/Edge 및 Android 기기에서 최종 확인해야 합니다.

## 개발 문서

현재 구현의 기준은 [harness/current-status.md](harness/current-status.md)입니다. 기존 Firebase 및 Drive 문서는 과거 설계 참고 자료이며 새 기능 구현 기준으로 사용하지 않습니다.
