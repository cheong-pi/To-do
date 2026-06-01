# LLM 코딩 에이전트 작업 규칙

## 에이전트 역할

| 역할 | 책임 |
|---|---|
| Planner | 작업 분해, 영향 범위 파악, 검증 계획 작성 |
| Executor | 코드와 문서 수정, 도구 실행 |
| Reviewer | 제품 규칙, 스키마, UX 규칙 위반 검토 |
| Verifier | 테스트, 빌드, 타입 체크, PWA 동작 검증 |
| Memory Manager | 결정사항과 반복 실수 방지 규칙 갱신 |
| Recovery Manager | 실패 원인 분석, 롤백 대신 안전한 수정 계획 제시 |

## 기본 개발 순서

1. `/harness/app-goal.md`를 확인한다.
2. `/harness/product-rules.md`를 확인한다.
3. `/harness/data-schema.md`를 확인한다.
4. 변경 대상 파일을 읽는다.
5. 스키마나 제품 규칙을 바꾸어야 하면 먼저 문서를 수정한다.
6. 작은 단위로 구현한다.
7. 검증 체크리스트를 실행한다.
8. 변경 요약과 남은 위험을 기록한다.

## 파일 읽기와 인코딩 규칙

- 모든 텍스트 파일은 UTF-8로 저장한다.
- Windows PowerShell에서 한글 파일을 읽을 때는 `Get-Content -Encoding UTF8 <path>`를 사용한다.
- 한글이 깨져 보이는 출력은 제품 문구 오류로 단정하지 말고, 먼저 UTF-8로 다시 읽어 확인한다.
- README, HTML, JS, manifest, harness 문서의 한글 문구는 브라우저와 UTF-8 출력에서 정상 표시되어야 한다.

## 금지 사항

- 사용자 데이터 삭제 로직 추가 금지
- 마이그레이션 문서 없는 스키마 파괴 변경 금지
- 오늘 화면에 기본 행동 버튼 4개 이상 추가 금지
- 미룸을 실패로 표현하는 문구 추가 금지
- 단어 직접 입력 기능을 MVP 핵심 흐름으로 추가 금지
- 앱 첫 화면을 월간 캘린더로 변경 금지
- 완료를 타이머 종료만으로 자동 처리 금지

## 변경 전 체크

```pseudo
function before_change(request):
    read(app_goal)
    read(product_rules)
    read(data_schema)
    scope = identify_files(request)
    risk = assess_risk(scope)

    if schema_change and no_migration_doc:
        stop("마이그레이션 문서가 필요함")

    if touches_user_data_delete:
        stop("기존 사용자 데이터 삭제 금지")

    return implementation_plan
```

## 작업 분해 기준

| 작업 | 권장 단위 |
|---|---|
| UI 화면 | 화면 1개 또는 주요 컴포넌트 1개 |
| 데이터 모델 | collection 1개 |
| Firebase 연동 | Auth, Firestore, Hosting을 분리 |
| 알림 | 앱 내부 타이머와 PWA 알림을 분리 |
| 단어 복습 | 출제, 채점, 스케줄링을 분리 |
| 기록 | event 저장과 통계 계산을 분리 |
| 스타일 | 컴포넌트별 CSS Modules로 분리 |

## MVP 태스크 백로그

| 순서 | 태스크 | 완료 조건 |
|---:|---|---|
| 1 | 하네스 문서 추가 | `/harness` 문서 6개 존재 |
| 2 | 현재 PWA 인코딩 정리 | README/화면 문구가 정상 한글 표시 |
| 3 | React 프로젝트 구조 생성 | Vite 또는 Next 기반 실행 가능 |
| 4 | Firebase 설정 | Auth/Firestore/Hosting 설정 분리 |
| 5 | Google 로그인 | 같은 계정으로 세션 유지 |
| 6 | 초기 설정 | 기본값 저장, 재방문 시 건너뜀 |
| 7 | 오늘 화면 | 오늘 할 일과 기본 버튼 3개 표시 |
| 8 | 루틴 자동 생성 | 오늘 해당 루틴 task 생성 |
| 9 | 예정 화면 | 날짜/마감/날짜 없는 할 일과 진행률 관리 |
| 10 | 미루기/연기/취소 처리 | 10분 재알림, 3회 제한, 연기 전환 |
| 11 | 선택형 뽀모도로 타이머 | 마지막 설정 저장, 세션 미저장, 완료 확인 플로우 |
| 12 | 단어 복습 | 3000개 기본 세트, 20개 학습 후 퀴즈, 오답 반복 |
| 13 | 월간 화면 | 완료/미룸 기록 표시 |
| 14 | 기록 화면 | 월간 통계 표시 |
| 15 | PWA 알림 | 설치 및 브라우저 알림 |

## 작업 완료 보고 형식

```text
변경:
- ...

검증:
- ...

남은 위험:
- ...
```
