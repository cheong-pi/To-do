# Google Drive 동기화

## 저장 원칙

- 앱 사용 중 데이터는 브라우저 `localStorage`에 즉시 저장한다.
- Google Drive 연결은 선택 사항이며 오프라인 로컬 사용을 막지 않는다.
- 연결하면 로그인한 사용자의 `appDataFolder`에 `dont-forget-data.json` 하나를 저장한다.
- 이 파일은 일반 Drive 목록에 노출되지 않는 앱 전용 비공개 데이터다.
- 저장 용량은 앱 개발자의 계정이 아니라 로그인한 사용자의 Google Drive 용량을 사용한다.

## Google Cloud 설정

1. Google Cloud 프로젝트를 만든다.
2. Google Drive API를 활성화한다.
3. OAuth 동의 화면을 구성한다.
4. 웹 애플리케이션 OAuth 클라이언트 ID를 만든다.
5. 승인된 JavaScript 원본에 개발 주소와 실제 HTTPS 배포 주소를 추가한다.
6. `.env`에 클라이언트 ID를 입력한다.

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

`.env`는 Git에 커밋하지 않는다.

## 연결과 충돌 처리

```text
Drive 연결
  ├─ 원격 백업 없음 → 현재 로컬 데이터를 최초 업로드
  ├─ 원격과 로컬 동일 → 마지막 동기화 시간만 갱신
  └─ 원격과 로컬 다름
       ├─ 로컬 자동 복구본 생성
       └─ 사용자에게 Drive 데이터 / 현재 데이터 선택 요청
```

원격과 로컬이 다를 때는 자동으로 어느 한쪽을 덮어쓰지 않는다. 사용자가 원격 데이터를 선택하면 앱을 다시 불러오고, 현재 데이터를 선택하면 Drive 파일을 현재 데이터로 갱신한다.

## 동기화 범위

- 할일과 일정
- 앱 설정
- 계획표 루틴
- 메모
- 단어 학습 기록
- 타이머 설정과 일별 집중 기록
- 달력 일별 기록

실행 중인 타이머의 초 단위 상태는 기기 로컬에만 보관한다.

## 보안

- OAuth 액세스 토큰은 `sessionStorage`에만 보관한다.
- 브라우저 세션이 끝나면 다시 동의를 받을 수 있다.
- 앱은 `drive.appdata` 최소 범위만 요청한다.
- 일반 Drive 파일 읽기, 공유, 삭제 권한은 요청하지 않는다.
