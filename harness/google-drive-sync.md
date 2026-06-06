# Google Drive 동기화

## 저장 원칙

- 앱 사용 중 데이터는 브라우저 `localStorage`에 즉시 저장한다.
- Google Drive 연결 시 사용자 본인의 `appDataFolder`에 `dont-forget-data.json` 파일 하나를 저장한다.
- `appDataFolder`는 앱 전용 숨김 공간이므로 앱은 사용자의 일반 Drive 파일을 읽지 않는다.
- 파일 용량은 앱 개발자의 Firebase가 아니라 로그인한 사용자의 Google Drive 저장공간에 포함된다.
- Drive 연결이 없어도 로컬 기능은 계속 사용할 수 있다.

## Google Cloud 설정

1. Google Cloud Console에서 프로젝트를 생성한다.
2. Google Drive API를 활성화한다.
3. OAuth 동의 화면을 구성한다.
4. 웹 애플리케이션 OAuth 클라이언트 ID를 생성한다.
5. 승인된 JavaScript 원본에 개발 주소 `http://127.0.0.1:5173`과 실제 배포 주소를 추가한다.
6. `.env.example`을 참고해 `.env`에 다음 값을 입력한다.

```env
VITE_GOOGLE_CLIENT_ID=발급받은_클라이언트_ID
```

`.env`는 Git에 커밋하지 않는다.

## 동기화 흐름

```text
Drive 연결
  ├─ 기존 백업 있음 → 로컬에 복원 → 앱 새로고침
  └─ 기존 백업 없음 → 현재 로컬 데이터 업로드

앱 사용
  ├─ 로컬에 즉시 저장
  ├─ 변경 감지 후 최대 15초 안에 Drive 업로드
  └─ 앱이 백그라운드로 이동할 때 한 번 더 업로드
```

## 동기화 대상

- 할 일
- 일정
- 앱 설정
- 계획표 루틴
- 메모
- 단어 학습 기록

타이머 진행 상태는 저장하지 않는다.

## 주의사항

- OAuth 액세스 토큰은 현재 브라우저 탭 세션에만 보관하며 Git이나 영구 `localStorage`에 저장하지 않는다.
- 브라우저를 완전히 닫은 뒤에는 Drive 연결 동의를 다시 받아야 할 수 있다.
- 두 기기에서 동시에 수정하면 마지막 업로드가 우선한다. 이후 단계에서 레코드별 충돌 병합을 추가한다.
