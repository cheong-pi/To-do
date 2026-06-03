# Firebase 데이터 저장 계획

## 핵심 원칙

- 사용자 데이터는 Git에 저장하지 않는다.
- Git에는 코드, 문서, 예시 설정 파일만 저장한다.
- 실제 사용자 데이터는 Firestore의 `users/{userId}` 하위 경로에만 저장한다.
- `.env`, `.env.local`, `.env.production` 같은 실제 Firebase 설정 파일은 Git에 올리지 않는다.
- `.env.example`만 Git에 올려 필요한 환경변수 이름을 공유한다.
- Firestore 보안 규칙은 로그인한 사용자가 자기 `userId` 경로만 읽고 쓰게 제한한다.

## Git에 저장되는 것과 저장되지 않는 것

| 구분 | Git 저장 여부 | 설명 |
|---|---:|---|
| React/TypeScript 코드 | 저장 | 앱 화면과 로직 |
| CSS | 저장 | 앱 디자인 |
| `/harness` 문서 | 저장 | 개발 규칙과 스키마 문서 |
| `.env.example` | 저장 | 필요한 환경변수 이름만 포함 |
| `.env` | 저장 금지 | 실제 Firebase 프로젝트 키 |
| Firestore 사용자 데이터 | 저장 안 됨 | Google 계정별 클라우드 데이터 |
| 브라우저 localStorage 데이터 | 저장 안 됨 | 사용자의 브라우저 내부 저장 |
| 백업 JSON | 저장 금지 권장 | 사용자가 직접 받은 개인 데이터 |

## Firestore 경로

### MVP 현재 구현

```text
users/{userId}/tasks/{taskId}
users/{userId}/appData/settings
users/{userId}/appData/wordProgress
users/{userId}/appData/memos
users/{userId}/appData/planBlocks
```

`appData` 문서는 현재 로컬 저장 구조를 빠르게 클라우드로 옮기기 위한 MVP 구조다. 각 문서는 다음 형태를 가진다.

```ts
type UserAppDataDocument<T> = {
  value: T;
  updatedAt: Timestamp;
};
```

### 장기 분리 목표

```text
users/{userId}/settings/default
users/{userId}/tasks/{taskId}
users/{userId}/schedules/{scheduleId}
users/{userId}/routines/{routineId}
users/{userId}/routineRules/{ruleId}
users/{userId}/wordProgress/{wordId}
users/{userId}/memos/{memoId}
users/{userId}/events/{eventId}
```

## 컬렉션 역할

| 컬렉션 | 역할 | 현재 앱 대응 |
|---|---|---|
| `settings` | 앱 표시 설정, 언어, 폰트, 기본 학습량 | 설정 탭 |
| `tasks` | 오늘 할일, 날짜 없는 할일, D-day 할일 | 할일 탭 |
| `schedules` | 약속, 기간 일정, 달력 텍스트 일정 | 달력/할일 일정 등록 |
| `routines` | 생활 루틴 이름 | 계획표 |
| `routineRules` | 반복 규칙, 색상, 시작/종료일, 요일 | 반복 할일 |
| `wordProgress` | 단어별 학습/복습 기록 | 단어 외우기 |
| `memos` | 메모 | 메모 탭 |
| `events` | 완료, 취소, 복습 등 행동 로그 | 이후 통계/분석 |

## 동기화 단계

1. `tasks`만 Firestore 동기화한다.
2. `settings`, `memos`, `wordProgress`, `planBlocks`를 각각 Firestore 컬렉션으로 분리한다.
3. `schedule`과 `task`를 분리해 달력 일정과 할일을 독립 저장한다.
4. 반복 규칙은 `routines`와 `routineRules`로 분리한다.
5. 완료 기록은 `events` 또는 날짜별 기록 컬렉션으로 분리한다.

## 충돌 처리 규칙

- 기본은 `updatedAt`이 최신인 문서를 우선한다.
- 완료 기록, 단어 학습 기록처럼 누적되는 데이터는 덮어쓰기보다 병합한다.
- 클라우드가 비어 있고 로컬 데이터가 있으면 최초 로그인 시 로컬 데이터를 업로드한다.
- 클라우드와 로컬이 모두 있으면 사용자에게 병합 또는 클라우드 사용을 선택하게 하는 것이 최종 목표다.

## 삭제 정책

- 설정 탭의 `데이터 삭제하기`는 로컬 데이터를 삭제한다.
- 클라우드 데이터 삭제는 별도 확인 UI를 둔다.
- 클라우드 삭제는 실수 위험이 크므로 MVP에서는 로컬 삭제와 분리한다.
- 삭제 전 백업을 권장한다.

## 보안 규칙

현재 규칙은 다음 방향을 유지한다.

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 다음 구현 작업

1. `taskCloudStorage.ts`를 범용 사용자 데이터 저장소로 확장한다.
2. `settings`, `memos`, `wordProgress`, `planBlocks` 저장 서비스를 추가한다.
3. 현재 localStorage 키를 Firestore 문서 구조에 맞춰 마이그레이션한다.
4. 로그인 직후 로컬 데이터가 있으면 클라우드 초기 업로드를 수행한다.
5. 설정 탭에 클라우드 동기화 상태를 표시한다.
