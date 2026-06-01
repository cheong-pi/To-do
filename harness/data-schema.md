# 데이터 스키마

## 저장 구조

Firebase Auth, Firestore, Firebase Hosting, PWA를 기본 구조로 한다.

```text
users/{userId}/settings/default
users/{userId}/tasks/{taskId}
users/{userId}/routines/{routineId}
users/{userId}/routineRules/{routineRuleId}
users/{userId}/taskInstances/{taskInstanceId}
users/{userId}/wordReviews/{wordReviewId}
users/{userId}/wordBatches/{wordBatchId}
users/{userId}/events/{eventId}
users/{userId}/notifications/{notificationId}
```

## 공통 규칙

- 모든 문서에는 `createdAt`, `updatedAt`을 둔다.
- 시간은 Firestore Timestamp 또는 ISO 문자열 중 하나로 통일한다. Firebase 사용 시 Firestore Timestamp를 우선한다.
- 사용자의 기존 데이터를 삭제하는 변경은 금지한다.
- 필드 제거는 마이그레이션 문서와 백업 전략이 있을 때만 허용한다.
- enum 값 추가는 가능하지만 기존 enum 의미 변경은 금지한다.
- 로컬 캐시와 원격 DB 동기화 충돌 시 `updatedAt`이 최신인 항목을 기본으로 하되, 완료/실행 기록은 별도 event log를 보존한다.

## settings

```ts
type UserSettings = {
  id: "default";
  appName: "잊지 마";
  dailyTaskGoal: number;        // default: 15
  dailyWordGoal: number;        // default: 20
  wordLearningBatchSize: number; // default: 20
  notificationStartTime: string; // "09:00"
  defaultSnoozeMinutes: number; // default: 10
  lastFocusMinutes: number;     // default: 25
  lastBreakMinutes: number;     // default: 5
  lastPomodoroRounds: number;   // default: 4
  onboardingCompleted: boolean;
  timezone: string;             // e.g. "Asia/Seoul"
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## task

```ts
type TaskStatus =
  | "planned"
  | "started"
  | "done"
  | "postponed"
  | "cancelled";

type TaskPriority = "high" | "normal" | "low";
type TaskKind = "task" | "routine";
type TaskSource = "manual" | "routine" | "deadline" | "no_date";
type TodaySortGroup =
  | "timed_today"
  | "pulled_to_today"
  | "repeat_today"
  | "near_deadline"
  | "started"
  | "no_date";

type Task = {
  id: string;
  userId: string;
  title: string;
  date: string | null;       // YYYY-MM-DD. 오늘 실행일.
  dueDate: string | null;    // YYYY-MM-DD. 마감일.
  time: string | null;       // HH:mm.
  type: TaskKind;
  source: TaskSource;
  status: TaskStatus;
  priority: TaskPriority;
  todaySortGroup: TodaySortGroup | null;
  postponeCount: number;
  progressPercent: number;  // 0-100. 오늘 처리한 진행률.
  remainingPercent: number; // 100 - progressPercent.
  reminderAt: Timestamp | null;
  routineId: string | null;
  parentTaskId: string | null; // 오늘로 가져온 원본이 있으면 연결.
  memo: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  postponedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
};
```

## routine

```ts
type Routine = {
  id: string;
  userId: string;
  title: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type RoutineRule = {
  id: string;
  userId: string;
  routineId: string;
  version: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD
  repeatKind: "daily" | "weekly" | "date_range" | "monthly";
  daysOfWeek: number[]; // 0 Sunday - 6 Saturday
  dayOfMonth: number | null; // monthly에서 1-31
  startDate: string;
  endDate: string | null;
  time: string | null;
  calendarColor: string;
  createdAt: Timestamp;
};

type TaskInstance = {
  id: string;
  userId: string;
  routineId: string | null;
  routineRuleId: string | null;
  date: string;
  title: string;
  status: "planned" | "started" | "done" | "postponed" | "cancelled";
  progressPercent: number;
  remainingPercent: number;
  isGenerated: boolean;
  isManuallyEdited: boolean;
  completedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

반복 일정은 사용자가 직접 설정해야 한다. 앱이 기본 루틴을 임의로 고정 생성하지 않는다.
반복 일정 원본, 반복 규칙, 날짜별 실행 기록은 분리한다. 과거 실행 기록은 반복 규칙 수정으로 바꾸지 않는다.

## 반복 규칙 변경 규칙

```pseudo
function updateRoutineFromDate(routineId, changeDate, newRule):
    oldRule = getActiveRule(routineId, changeDate)
    oldRule.effectiveTo = changeDate - 1 day

    create RoutineRule({
        routineId,
        version: oldRule.version + 1,
        effectiveFrom: changeDate,
        effectiveTo: oldRule.effectiveToOriginal,
        ...newRule
    })

    futureInstances = getInstancesAfter(routineId, changeDate)

    for instance in futureInstances:
        if instance.status in ["done", "postponed", "cancelled"]:
            keep(instance)
        else if instance.isManuallyEdited:
            keep(instance)
        else:
            deactivate(instance)

    generateFutureInstances(newRule)
```

반복 일정 수정 UX 기본값은 `앞으로만 변경`이다. 선택지는 `이 일정만 변경`, `앞으로만 변경`, `전체 변경`으로 둔다. 어떤 경우에도 과거 실행 기록은 삭제하거나 덮어쓰지 않는다.

## wordReview

```ts
type WordReviewState = "new" | "learning" | "memorized";
type WordReviewLevel = "elementary" | "middle_school";

type WordReview = {
  id: string;
  userId: string;
  word: string;
  meaning: string;
  example: string;
  category: string;
  level: WordReviewLevel;
  state: WordReviewState;
  nextReviewDate: string; // YYYY-MM-DD
  correctCount: number;
  wrongCount: number;
  currentBatchId: string | null;
  lastSeenAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## wordBatch

20개 학습 후 질문/복습 단계로 넘어가는 단어 학습 흐름을 기록한다.

```ts
type WordBatchStatus = "learning" | "quiz" | "reviewing_mistakes" | "completed";

type WordBatch = {
  id: string;
  userId: string;
  wordReviewIds: string[]; // 기본 20개.
  status: WordBatchStatus;
  currentIndex: number;
  mistakeWordReviewIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
};
```

## notification

할 일 시작 시간과 미루기 재알림을 저장한다.

```ts
type NotificationStatus = "scheduled" | "sent" | "snoozed" | "cancelled";

type TaskNotification = {
  id: string;
  userId: string;
  taskId: string;
  scheduledAt: Timestamp;
  status: NotificationStatus;
  message: string; // 기본적으로 할 일 제목.
  snoozeCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
```

## timer

뽀모도로 실행 세션은 서버에 저장하지 않는다. 앱은 실행 중인 타이머 상태를 클라이언트 메모리 또는 로컬 상태로만 관리한다. 서버에는 `settings`의 마지막 사용값만 저장한다.

## event

분석과 회고를 위해 사용자 행동 이벤트를 보존한다.

```ts
type EventType =
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_postponed"
  | "task_cancelled"
  | "task_progress_updated"
  | "notification_snoozed"
  | "word_seen"
  | "word_known"
  | "word_confused"
  | "word_unknown";

type UserEvent = {
  id: string;
  userId: string;
  type: EventType;
  entityId: string | null;
  entityType: "task" | "routine" | "wordReview" | "notification" | null;
  payload: Record<string, unknown>;
  createdAt: Timestamp;
};
```

## 오늘 완료/진행률 규칙

```pseudo
function completeTodayTask(task, progressPercent):
    progressPercent = clamp(progressPercent, 0, 100)
    task.progressPercent = progressPercent
    task.remainingPercent = 100 - progressPercent

    if progressPercent >= 100:
        task.status = "done"
        task.completedAt = now

        if task.parentTaskId:
            parent = loadTask(task.parentTaskId)
            parent.status = "done"
            parent.completedAt = now
    else:
        task.status = "done" // 그날의 done으로 계산

        if task.parentTaskId:
            parent = loadTask(task.parentTaskId)
            parent.progressPercent = progressPercent
            parent.remainingPercent = 100 - progressPercent
            parent.status = "planned"
```

## 오늘 정렬 규칙

오늘 화면은 최대 15개까지만 표시한다.

```pseudo
function getTodaySortGroup(task):
    if task.date == today and task.time:
        return "timed_today"
    if task.parentTaskId and task.date == today:
        return "pulled_to_today"
    if task.source == "routine" and task.date == today:
        return "repeat_today"
    if task.dueDate and daysUntil(task.dueDate) <= 5:
        return "near_deadline"
    if task.status == "started":
        return "started"
    if task.date == null:
        return "no_date"

function sortTodayTasks(tasks):
    order = [
        "timed_today",
        "pulled_to_today",
        "repeat_today",
        "near_deadline",
        "started",
        "no_date"
    ]
    return tasks.sortBy(order.indexOf(task.todaySortGroup), task.time, task.dueDate).take(15)
```

## 미루기/연기 규칙

```pseudo
function snoozeTask(task):
    if task.postponeCount < 3:
        task.postponeCount += 1
        task.reminderAt = now + 10 minutes
        createNotification(task, task.reminderAt)
        return

    task.status = "postponed"
    task.postponedAt = now
```

```pseudo
function rolloverPostponedTask(task, nextDayHasSameTask):
    if nextDayHasSameTask:
        task.status = "cancelled"
        task.cancelledAt = now
        return

    task.status = "postponed"
    task.date = today
```

## 단어 복습 규칙

```pseudo
function updateWordReview(wordReview, result):
    if result == "known":
        wordReview.correctCount += 1
        if wordReview.correctCount >= 3:
            wordReview.state = "memorized"
            wordReview.nextReviewDate = today + 7 days
        else:
            wordReview.state = "learning"
            wordReview.nextReviewDate = today + 3 days

    if result == "confused":
        wordReview.wrongCount += 1
        wordReview.state = "learning"
        wordReview.nextReviewDate = tomorrow

    if result == "unknown":
        wordReview.wrongCount += 1
        wordReview.state = "learning"
        wordReview.nextReviewDate = today
```

## 단어 배치 학습 규칙

```pseudo
function createWordBatch(user):
    words = selectDueWords(limit = user.settings.wordLearningBatchSize) // default 20
    return WordBatch(status = "learning", wordReviewIds = words)

function finishLearningBatch(batch):
    batch.status = "quiz"
    batch.currentIndex = 0

function answerQuiz(batch, wordReview, result):
    updateWordReview(wordReview, result)

    if result != "known":
        batch.mistakeWordReviewIds.add(wordReview.id)

    if reachedEnd(batch.wordReviewIds):
        if batch.mistakeWordReviewIds.length > 0:
            batch.status = "reviewing_mistakes"
            batch.wordReviewIds = batch.mistakeWordReviewIds
            batch.mistakeWordReviewIds = []
            batch.currentIndex = 0
        else:
            batch.status = "completed"
            batch.completedAt = now
```

## 마이그레이션 규칙

마이그레이션 파일은 다음 형식을 따른다.

```text
migrations/YYYYMMDD-short-name.md
```

각 마이그레이션 문서는 다음을 포함한다.

- 변경 이유
- 변경 전 스키마
- 변경 후 스키마
- 기존 데이터 변환 방식
- 롤백 전략
- 검증 방법
