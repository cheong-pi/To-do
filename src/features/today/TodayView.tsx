import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { sortTodayTasks } from "./todayRules";
import styles from "./TodayView.module.css";
import { isFirebaseConfigured, signInWithGoogle, signOutUser, subscribeAuthState } from "../../services/firebase";
import { saveUserTasks, subscribeUserTasks } from "../../services/taskCloudStorage";
import { loadStoredTasks, saveStoredTasks } from "../../services/taskStorage";
import type { RepeatKind, Task, TaskKindOption, TaskOwner, TaskSource, TaskStatus, TodaySortGroup } from "../../types/task";
import type { User } from "firebase/auth";

type AppTab = "plan" | "tasks" | "calendar" | "words" | "pomodoro" | "memo" | "settings";

type AppLanguage = "ko" | "en";

type FontMode = "default" | "system";

type Memo = {
  id: string;
  content: string;
  createdAt: string;
};

type PlanBlock = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  kind: "life" | "task";
  taskId: string | null;
};

type WordProgressRecord = {
  en: string;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  lastSeenAt: string | null;
  nextReviewAt: string;
  lastResult: "studied" | "correct" | "wrong";
};

const tabLabels: Record<AppLanguage, Record<AppTab, string>> = {
  ko: {
    plan: "계획표",
    tasks: "할일",
    calendar: "달력",
    words: "단어 외우기",
    pomodoro: "타이머",
    memo: "메모",
    settings: "설정"
  },
  en: {
    plan: "Planner",
    tasks: "Tasks",
    calendar: "Calendar",
    words: "Vocabulary",
    pomodoro: "Timer",
    memo: "Memo",
    settings: "Settings"
  }
};

const tabs: AppTab[] = [
  "plan",
  "tasks",
  "calendar",
  "words",
  "pomodoro",
  "memo",
  "settings"
];

const kindOptions: Array<{ id: TaskKindOption; label: string; description: string }> = [
  { id: "no_deadline", label: "기한 없음", description: "날짜 없이 보관" },
  { id: "today", label: "오늘", description: "오늘 할 일" },
  { id: "dday", label: "D-day", description: "마감일 계산" },
  { id: "repeat", label: "반복설정", description: "기간/요일/매월" }
];

const fixedKindColors: Record<Exclude<TaskKindOption, "repeat">, string> = {
  no_deadline: "#E8E1D2",
  today: "#FFF0A8",
  dday: "#FF9F8F"
};

const repeatCalendarColors = [
  "#FFE680",
  "#BFE3FF",
  "#D7F5C8",
  "#CDB4DB",
  "#FFC8DD",
  "#A3C4F3",
  "#B8F2E6",
  "#FDE2E4",
  "#DEE2FF",
  "#CDEAC0",
  "#F1C0E8",
  "#FFD6A5"
];

const seedWords = [
  { en: "diligent", pos: "adj.", ko: "성실한, 부지런한", ex: "She is a diligent student." },
  { en: "consistent", pos: "adj.", ko: "일관된, 꾸준한", ex: "Consistent effort matters." },
  { en: "momentum", pos: "n.", ko: "탄력, 가속도", ex: "The project gained momentum." },
  { en: "resilient", pos: "adj.", ko: "회복력 있는", ex: "A resilient person tries again." },
  { en: "deliberate", pos: "adj.", ko: "신중한, 의도적인", ex: "It was a deliberate choice." },
  { en: "thrive", pos: "v.", ko: "번성하다, 잘 자라다", ex: "Plants thrive in sunlight." },
  { en: "nurture", pos: "v.", ko: "기르다, 보살피다", ex: "Good habits nurture growth." },
  { en: "perseverance", pos: "n.", ko: "끈기, 인내", ex: "Perseverance helps you continue." },
  { en: "attempt", pos: "v.", ko: "시도하다", ex: "Try one small attempt." },
  { en: "focus", pos: "v.", ko: "집중하다", ex: "Focus on one task." },
  { en: "review", pos: "v.", ko: "복습하다, 검토하다", ex: "Review the words tomorrow." },
  { en: "improve", pos: "v.", ko: "개선하다", ex: "Practice helps you improve." },
  { en: "effort", pos: "n.", ko: "노력", ex: "Small effort counts." },
  { en: "habit", pos: "n.", ko: "습관", ex: "A habit grows slowly." },
  { en: "schedule", pos: "n.", ko: "일정", ex: "Check your schedule." },
  { en: "reminder", pos: "n.", ko: "알림", ex: "Set a reminder." },
  { en: "complete", pos: "v.", ko: "완료하다", ex: "Complete one task first." },
  { en: "pause", pos: "v.", ko: "잠시 멈추다", ex: "Pause and breathe." },
  { en: "repeat", pos: "v.", ko: "반복하다", ex: "Repeat the word aloud." },
  { en: "steady", pos: "adj.", ko: "꾸준한, 안정된", ex: "Keep a steady pace." }
];

const learnedWordsStorageKey = "dont-forget-learned-words";
const memoStorageKey = "dont-forget-memos";
const planBlocksStorageKey = "dont-forget-plan-blocks";
const appSettingsStorageKey = "dont-forget-app-settings";

export function TodayView() {
  const [activeTab, setActiveTab] = useState<AppTab>("plan");
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => loadAppSettings().language);
  const [fontMode, setFontMode] = useState<FontMode>(() => loadAppSettings().fontMode);
  const [tasks, setTasks] = useState<Task[]>(() => loadStoredTasks());
  const [selectedDate, setSelectedDate] = useState("2026-06-02");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [activeCreatePanel, setActiveCreatePanel] = useState<"task" | "schedule" | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authMessage, setAuthMessage] = useState(
    isFirebaseConfigured() ? "Google 로그인 준비됨" : "Firebase 설정 필요"
  );
  const isApplyingRemoteTasks = useRef(false);
  const hasReceivedRemoteTasks = useRef(false);

  const todayTasks = useMemo(() => sortTodayTasks(getTasksForDate(tasks, selectedDate)), [tasks, selectedDate]);
  const editingTask = tasks.find((task) => task.id === editingTaskId) ?? null;
  const fixedTaskTags = useMemo(() => getFixedTaskTags(tasks), [tasks]);

  useEffect(() => {
    document.documentElement.dataset.fontMode = fontMode;
    document.documentElement.lang = appLanguage === "ko" ? "ko" : "en";
    saveAppSettings({ language: appLanguage, fontMode });
  }, [appLanguage, fontMode]);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;

    return subscribeAuthState((user) => {
      setAuthUser(user);
      hasReceivedRemoteTasks.current = false;
      setAuthMessage(user ? `${user.displayName ?? "Google"} 동기화 중` : "Google 로그인 준비됨");
    });
  }, []);

  useEffect(() => {
    if (!authUser) return;

    return subscribeUserTasks(
      authUser.uid,
      (remoteTasks) => {
        if (remoteTasks.length === 0 && !hasReceivedRemoteTasks.current && tasks.length > 0) {
          void saveUserTasks(authUser.uid, tasks);
          hasReceivedRemoteTasks.current = true;
          setAuthMessage(`${authUser.displayName ?? "Google"} 동기화 완료`);
          return;
        }

        hasReceivedRemoteTasks.current = true;
        isApplyingRemoteTasks.current = true;
        setTasks(remoteTasks);
        setAuthMessage(`${authUser.displayName ?? "Google"} 동기화 완료`);
      },
      () => {
        setAuthMessage("동기화 오류: 로컬 저장 중");
      }
    );
  }, [authUser]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      if (!authUser || !hasReceivedRemoteTasks.current || isApplyingRemoteTasks.current) return;
      void saveUserTasks(authUser.uid, tasks).catch(() => {
        setAuthMessage("동기화 오류: 로컬 저장 중");
      });
    }, 400);

    return () => window.clearTimeout(saveTimer);
  }, [authUser, tasks]);

  useEffect(() => {
    saveStoredTasks(tasks);
    if (isApplyingRemoteTasks.current) {
      isApplyingRemoteTasks.current = false;
    }
  }, [tasks]);

  function updateTask(nextTask: Task) {
    setTasks((current) => current.map((task) => (task.id === nextTask.id ? nextTask : task)));
  }

  function toggleTaskDone(task: Task, date: string) {
    if (isRepeatTask(task)) {
      const completedDates = task.completedDates ?? [];
      const isDone = completedDates.includes(date);
      updateTask({
        ...task,
        completedDates: isDone ? completedDates.filter((value) => value !== date) : [...completedDates, date].sort()
      });
      setEditingTaskId(null);
      return;
    }

    if (task.status === "done") {
      updateTask({
        ...task,
        status: "planned",
        progressPercent: 0,
        remainingPercent: 100
      });
      return;
    }

    updateTask({
      ...task,
      status: "done",
      progressPercent: 100,
      remainingPercent: 0
    });
    setEditingTaskId(null);
  }

  function saveTask(nextTask: Task) {
    updateTask(nextTask);
    setEditingTaskId(null);
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setEditingTaskId(null);
  }

  function addTask(task: Task) {
    setTasks((current) => [task, ...current]);
    setActiveCreatePanel(null);
  }

  async function handleGoogleLogin() {
    if (!isFirebaseConfigured()) {
      setAuthMessage(".env에 Firebase 설정값을 넣으면 로그인할 수 있어요.");
      return;
    }

    try {
      if (authUser) {
        await signOutUser();
        setAuthMessage("Google 로그인 준비됨");
        return;
      }

      setAuthMessage("Google 로그인 중");
      await signInWithGoogle();
    } catch {
      setAuthMessage("로그인을 완료하지 못했어요.");
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>{appLanguage === "ko" ? "습관 기르기" : "Habit guide"}</p>
          <h1>{appLanguage === "ko" ? "잊지 마" : "Don't Forget"}</h1>
          <p className={styles.summary}>
            {appLanguage === "ko"
              ? "생활 루틴, 할일, 일정, 단어 외우기와 타이머를 한 흐름에서 관리합니다."
              : "Manage routines, tasks, schedules, words, and focus sessions in one flow."}
          </p>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="주요 화면">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? styles.activeTab : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tabLabels[appLanguage][tab]}
          </button>
        ))}
      </nav>

      {activeTab === "plan" && <PlanTab tasks={todayTasks} selectedDate={selectedDate} />}

      {activeTab === "tasks" && (
        <TasksTab
          todayTasks={todayTasks}
          editingTask={editingTask}
          activeCreatePanel={activeCreatePanel}
          fixedTaskTags={fixedTaskTags}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onToggleCreatePanel={(panel) => setActiveCreatePanel((current) => (current === panel ? null : panel))}
          onAddTask={addTask}
          onEdit={setEditingTaskId}
          onCloseEdit={() => setEditingTaskId(null)}
          onToggleDone={toggleTaskDone}
          onSaveTask={saveTask}
          onDeleteTask={deleteTask}
        />
      )}

      {activeTab === "calendar" && (
        <CalendarTab
          tasks={tasks}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onOpenTasks={() => setActiveTab("tasks")}
        />
      )}
      <WordsTab isActive={activeTab === "words"} />
      <PomodoroTab tasks={todayTasks} selectedDate={selectedDate} isActive={activeTab === "pomodoro"} />
      {activeTab === "memo" && <MemoTab />}
      {activeTab === "settings" && (
        <SettingsTab
          language={appLanguage}
          fontMode={fontMode}
          authUser={authUser}
          authMessage={authMessage}
          onLanguageChange={setAppLanguage}
          onFontModeChange={setFontMode}
          onBackup={() => backupAppData(tasks)}
          onGoogleLogin={handleGoogleLogin}
        />
      )}
    </main>
  );
}

type TasksTabProps = {
  todayTasks: Task[];
  editingTask: Task | null;
  activeCreatePanel: "task" | "schedule" | null;
  fixedTaskTags: string[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  onToggleCreatePanel: (panel: "task" | "schedule") => void;
  onAddTask: (task: Task) => void;
  onEdit: (taskId: string) => void;
  onCloseEdit: () => void;
  onToggleDone: (task: Task, date: string) => void;
  onSaveTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
};

function SettingsTab({
  language,
  fontMode,
  authUser,
  authMessage,
  onLanguageChange,
  onFontModeChange,
  onBackup,
  onGoogleLogin
}: {
  language: AppLanguage;
  fontMode: FontMode;
  authUser: User | null;
  authMessage: string;
  onLanguageChange: (language: AppLanguage) => void;
  onFontModeChange: (fontMode: FontMode) => void;
  onBackup: () => void;
  onGoogleLogin: () => void;
}) {
  return (
    <section className={styles.mainPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{language === "ko" ? "설정" : "Settings"}</h2>
          <p>
            {language === "ko"
              ? "앱 표시 방식과 계정, 백업을 여기에서 관리합니다."
              : "Manage app display, account, and backups here."}
          </p>
        </div>
      </div>

      <div className={styles.settingsStack}>
        <section className={styles.settingsGroup}>
          <div>
            <h3>{language === "ko" ? "폰트" : "Font"}</h3>
            <p>{language === "ko" ? "앱 기본 폰트와 유저 시스템 폰트 중에서 선택합니다." : "Choose between the app default font and your system font."}</p>
          </div>
          <div className={styles.segmentControl} aria-label={language === "ko" ? "폰트 선택" : "Font selection"}>
            <button type="button" className={fontMode === "default" ? styles.activeSegment : ""} onClick={() => onFontModeChange("default")}>
              {language === "ko" ? "기본 폰트" : "Default"}
            </button>
            <button type="button" className={fontMode === "system" ? styles.activeSegment : ""} onClick={() => onFontModeChange("system")}>
              {language === "ko" ? "시스템 폰트" : "System"}
            </button>
          </div>
        </section>

        <section className={styles.settingsGroup}>
          <div>
            <h3>{language === "ko" ? "언어" : "Language"}</h3>
            <p>{language === "ko" ? "앱의 주요 표시 언어를 바꿉니다." : "Change the main display language."}</p>
          </div>
          <div className={styles.segmentControl} aria-label={language === "ko" ? "언어 선택" : "Language selection"}>
            <button type="button" className={language === "ko" ? styles.activeSegment : ""} onClick={() => onLanguageChange("ko")}>
              한국어
            </button>
            <button type="button" className={language === "en" ? styles.activeSegment : ""} onClick={() => onLanguageChange("en")}>
              English
            </button>
          </div>
        </section>

        <section className={styles.settingsGroup}>
          <div>
            <h3>{language === "ko" ? "데이터" : "Data"}</h3>
            <p>{language === "ko" ? "현재 로컬 데이터와 앱 설정을 JSON 파일로 저장합니다." : "Save current local data and settings as a JSON file."}</p>
          </div>
          <button type="button" className={styles.settingsAction} onClick={onBackup}>
            {language === "ko" ? "데이터 백업하기" : "Back Up Data"}
          </button>
        </section>

        <section className={styles.settingsGroup}>
          <div>
            <h3>{language === "ko" ? "계정" : "Account"}</h3>
            <p>{authMessage}</p>
          </div>
          <button type="button" className={styles.settingsAction} onClick={onGoogleLogin}>
            {authUser ? (language === "ko" ? "Google 로그아웃" : "Sign Out") : language === "ko" ? "Google 로그인" : "Sign In With Google"}
          </button>
        </section>

        <section className={`${styles.settingsGroup} ${styles.helpGroup}`}>
          <div>
            <h3>{language === "ko" ? "도움말" : "Help"}</h3>
            {language === "ko" ? (
              <ul>
                <li>계획표: 생활 루틴과 시간 있는 할일을 한 시간표에서 봅니다.</li>
                <li>할일: 오늘 처리할 일과 일정 등록을 관리합니다.</li>
                <li>달력: 날짜별 일정과 완료 흐름을 확인합니다.</li>
                <li>단어 외우기: 먼저 외우고, 퀴즈로 확인하며, 복습 단어가 다시 섞입니다.</li>
                <li>타이머: 집중과 휴식을 그때그때 설정해서 사용합니다.</li>
              </ul>
            ) : (
              <ul>
                <li>Planner: View routines and timed tasks in one schedule.</li>
                <li>Tasks: Manage today&apos;s tasks and schedule entries.</li>
                <li>Calendar: Check dated events and completion flow.</li>
                <li>Vocabulary: Study first, quiz after, and review words return later.</li>
                <li>Timer: Set focus and break sessions as needed.</li>
              </ul>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PlanTab({ tasks, selectedDate }: { tasks: Task[]; selectedDate: string }) {
  const [planBlocks, setPlanBlocks] = useState<PlanBlock[]>(() => loadStoredPlanBlocks());
  const [isAddingRoutine, setIsAddingRoutine] = useState(false);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("09:30");
  const visibleTasks = useMemo(() => tasks.filter((task) => task.status !== "cancelled"), [tasks]);
  const timedTasks = useMemo(() => visibleTasks.filter((task) => Boolean(task.time)), [visibleTasks]);
  const untimedTasks = useMemo(() => visibleTasks.filter((task) => !task.time), [visibleTasks]);
  const timelineItems = useMemo(
    () =>
      [
        ...planBlocks.map((block) => ({
          id: block.id,
          title: block.title,
          startTime: block.startTime,
          endTime: block.endTime,
          kind: "life" as const,
          canDelete: true
        })),
        ...timedTasks.map((task) => ({
          id: `task-${task.id}`,
          title: task.title,
          startTime: task.time ?? "00:00",
          endTime: null,
          kind: "task" as const,
          canDelete: false
        }))
      ].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [planBlocks, timedTasks]
  );

  useEffect(() => {
    saveStoredPlanBlocks(planBlocks);
  }, [planBlocks]);

  function addPlanBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setPlanBlocks((current) => [
      ...current,
      {
        id: `plan-${Date.now()}`,
        title: trimmedTitle,
        startTime,
        endTime: endTime >= startTime ? endTime : startTime,
        kind: "life",
        taskId: null
      }
    ]);
    setTitle("");
    setIsAddingRoutine(false);
  }

  function deletePlanBlock(blockId: string) {
    setPlanBlocks((current) => current.filter((block) => block.id !== blockId));
  }

  return (
    <section className={styles.mainPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{formatDateHeading(selectedDate)} 계획표</h2>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.headerMeta}>{timelineItems.length}개</span>
          <button
            type="button"
            className={isAddingRoutine ? `${styles.addInlineButton} ${styles.activeInlineButton}` : styles.addInlineButton}
            onClick={() => setIsAddingRoutine((current) => !current)}
          >
            {isAddingRoutine ? "추가 닫기" : "루틴 추가"}
          </button>
        </div>
      </div>

      {isAddingRoutine && (
        <form className={styles.planComposer} onSubmit={addPlanBlock}>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>시작</span>
              <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>종료</span>
              <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </label>
          </div>
          <label className={styles.formRow}>
            <span>루틴 제목</span>
            <input
              value={title}
              placeholder="예: 아침식사"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button type="submit" className={styles.completeButton}>저장</button>
        </form>
      )}

      <div className={styles.planTimeline}>
        {timelineItems.map((item) => (
          <article
            key={item.id}
            className={item.kind === "task" ? `${styles.planBlock} ${styles.taskPlanBlock}` : styles.planBlock}
          >
            <time>{item.endTime ? `${item.startTime} ~ ${item.endTime}` : item.startTime}</time>
            <div>
              <strong>{item.title}</strong>
              <span>{item.kind === "task" ? "할일" : "생활 루틴"}</span>
            </div>
            {item.canDelete ? (
              <button type="button" onClick={() => deletePlanBlock(item.id)}>삭제</button>
            ) : (
              <span className={styles.planReadOnly}>자동</span>
            )}
          </article>
        ))}
      </div>

      <section className={styles.untimedTaskPanel}>
        <h3>시간 없는 할일</h3>
        {untimedTasks.length > 0 ? (
          <div className={styles.untimedTaskList}>
            {untimedTasks.map((task) => (
              <article key={task.id} className={styles.untimedTaskItem}>
                <strong>{task.title}</strong>
                <span>{task.source === "deadline" ? "D-day" : task.source === "routine" ? "반복" : "할일"}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.emptyState}>시간 없이 남아 있는 할일이 없습니다.</p>
        )}
      </section>
    </section>
  );
}

function TasksTab({
  todayTasks,
  editingTask,
  activeCreatePanel,
  fixedTaskTags,
  selectedDate,
  onDateChange,
  onToggleCreatePanel,
  onAddTask,
  onEdit,
  onCloseEdit,
  onToggleDone,
  onSaveTask,
  onDeleteTask
}: TasksTabProps) {
  return (
    <section className={styles.tabContent}>
      <section className={styles.mainPanel} aria-label="오늘 할 일">
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.titleNav} aria-label="날짜 이동">
              <button type="button" aria-label="이전 날짜" onClick={() => onDateChange(shiftDate(selectedDate, -1))}>
                &lt;
              </button>
              <h2>{formatDateHeading(selectedDate)} 할일</h2>
              <button type="button" aria-label="다음 날짜" onClick={() => onDateChange(shiftDate(selectedDate, 1))}>
                &gt;
              </button>
              <span className={styles.titleCount}>{todayTasks.length}</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              className={activeCreatePanel === "task" ? `${styles.addInlineButton} ${styles.activeInlineButton}` : styles.addInlineButton}
              type="button"
              onClick={() => onToggleCreatePanel("task")}
            >
              {activeCreatePanel === "task" ? "할일 닫기" : "할일 등록"}
            </button>
            <button
              className={activeCreatePanel === "schedule" ? `${styles.addInlineButton} ${styles.activeInlineButton}` : styles.addInlineButton}
              type="button"
              onClick={() => onToggleCreatePanel("schedule")}
            >
              {activeCreatePanel === "schedule" ? "일정 닫기" : "일정 등록"}
            </button>
          </div>
        </div>

        {activeCreatePanel === "task" && (
          <TaskCreateForm selectedDate={selectedDate} fixedTaskTags={fixedTaskTags} onAddTask={onAddTask} />
        )}
        {activeCreatePanel === "schedule" && <ScheduleCreateForm selectedDate={selectedDate} onAddTask={onAddTask} />}

        <div className={styles.taskList}>
          {todayTasks.map((task) => (
            <div key={task.id} className={styles.taskStack}>
              <TaskRow
                task={task}
                selectedDate={selectedDate}
                onEdit={(taskId) => {
                  if (editingTask?.id === taskId) {
                    onCloseEdit();
                    return;
                  }
                  onEdit(taskId);
                }}
                onToggleDone={onToggleDone}
                isEditing={editingTask?.id === task.id}
              />
              {editingTask?.id === task.id && !isSchedulerOwnedTask(task) && (
                <TaskEditor
                  task={editingTask}
                  selectedDate={selectedDate}
                  onSaveTask={onSaveTask}
                  onDeleteTask={onDeleteTask}
                />
              )}
            </div>
          ))}
        </div>

        <RepeatProgressDots tasks={todayTasks} selectedDate={selectedDate} />
      </section>
    </section>
  );
}

function RepeatProgressDots({ tasks, selectedDate }: { tasks: Task[]; selectedDate: string }) {
  const repeatTasks = tasks.filter(isRepeatTask);
  if (repeatTasks.length === 0) return null;

  return (
    <section className={styles.repeatProgress} aria-label="반복 진행 기록">
      <div className={styles.repeatProgressHeader}>
        <strong>반복 진행률</strong>
      </div>
      <div className={styles.repeatProgressList}>
        {repeatTasks.map((task) => {
          const targetDates = getRepeatProgressDates(task, selectedDate);
          const doneCount = targetDates.filter((day) => isTaskDoneOnDate(task, day)).length;
          const totalCount = targetDates.length;

          return (
            <article key={task.id} className={styles.repeatProgressItem}>
              <div className={styles.repeatProgressTitle}>
                <i style={{ backgroundColor: task.calendarColor ?? repeatCalendarColors[0] }} />
                <strong>{task.title}</strong>
              </div>
              <div className={styles.repeatProgressValue}>
                <span>{doneCount}/{totalCount}</span>
              </div>
              <div className={styles.repeatCheckGrid} aria-label={`${task.title} 반복 체크`}>
                {targetDates.map((day) => {
                  const isDone = isTaskDoneOnDate(task, day);
                  return (
                    <i
                      key={day}
                      title={`${day} ${isDone ? "완료" : "미완료"}`}
                      className={isDone ? styles.repeatCheckDone : ""}
                      style={isDone ? { backgroundColor: task.calendarColor ?? repeatCalendarColors[0] } : undefined}
                    />
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TaskRow({
  task,
  selectedDate,
  onEdit,
  onToggleDone,
  isEditing
}: {
  task: Task;
  selectedDate: string;
  onEdit: (taskId: string) => void;
  onToggleDone: (task: Task, date: string) => void;
  isEditing: boolean;
}) {
  const isCancelled = task.status === "cancelled";
  const isDone = isTaskDoneOnDate(task, selectedDate);
  const isSchedulerOwned = isSchedulerOwnedTask(task);

  return (
    <article className={`${styles.taskRow} ${isDone ? styles.done : styles[task.status]}`} aria-disabled={isCancelled}>
      <button
        className={styles.taskCheck}
        type="button"
        aria-label={isDone ? `${task.title} 완료 취소` : `${task.title} 완료`}
        disabled={isCancelled}
        onClick={() => onToggleDone(task, selectedDate)}
      >
        {isDone ? "✓" : ""}
      </button>
      <div className={styles.taskBody}>
        <div className={styles.taskTopline}>
          {(task.reminderAt || task.time) && <span>{formatReminderLabel(task)}</span>}
          {isSchedulerOwned && <span className={styles.scheduleTag}>일정</span>}
          {isRepeatTask(task) && <span className={styles.repeatTag}>반복</span>}
          {task.dueDate && <span className={getDeadlineClass(selectedDate, task.dueDate)}>{formatDday(selectedDate, task.dueDate)}</span>}
          {task.remainingPercent < 100 && <span>잔여 {task.remainingPercent}%</span>}
        </div>
        <h3>{task.title}</h3>
      </div>
      {isSchedulerOwned ? (
        <span className={styles.readonlyLabel}>스케쥴러</span>
      ) : (
        <button className={styles.editButton} type="button" onClick={() => onEdit(task.id)}>
          {isEditing ? "닫기" : "수정"}
        </button>
      )}
    </article>
  );
}

type TaskEditorProps = {
  task: Task;
  selectedDate: string;
  onSaveTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
};

function TaskEditor({ task, selectedDate, onSaveTask, onDeleteTask }: TaskEditorProps) {
  const initialKind = getTaskKindOption(task);
  const [title, setTitle] = useState(task.title);
  const [taskKind, setTaskKind] = useState<TaskKindOption>(initialKind);
  const [date, setDate] = useState(task.date ?? selectedDate);
  const [time, setTime] = useState(task.time ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [periodStartDate, setPeriodStartDate] = useState(task.periodStartDate ?? selectedDate);
  const [periodEndDate, setPeriodEndDate] = useState(task.periodEndDate ?? "");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>(normalizeRepeatKind(task.repeatKind));
  const [repeatDaysOfWeek, setRepeatDaysOfWeek] = useState<number[]>(task.repeatDaysOfWeek ?? []);
  const [repeatDayOfMonth, setRepeatDayOfMonth] = useState(String(task.repeatDayOfMonth ?? ""));
  const [memo, setMemo] = useState(task.memo);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [progress, setProgress] = useState(task.progressPercent);
  const [isFixed, setIsFixed] = useState(Boolean(task.isFixed));
  const [calendarColor, setCalendarColor] = useState(task.calendarColor ?? repeatCalendarColors[0]);

  function changeProgress(next: number) {
    setProgress(Math.min(100, Math.max(0, next)));
  }

  function handleKindChange(nextKind: TaskKindOption) {
    setTaskKind(nextKind);
    if (nextKind === "repeat" && repeatKind === "none") setRepeatKind("daily");
    if (nextKind !== "repeat") setRepeatKind("none");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeScheduleFields(taskKind, {
      selectedDate,
      date,
      time,
      dueDate,
      periodStartDate,
      periodEndDate,
      repeatKind,
      repeatDaysOfWeek,
      repeatDayOfMonth,
      calendarColor
    });
    const clampedProgress = Math.min(100, Math.max(0, progress));

    onSaveTask({
      ...task,
      title: title.trim() || task.title,
      date: normalized.date,
      dueDate: normalized.dueDate,
      periodStartDate: normalized.periodStartDate,
      periodEndDate: normalized.periodEndDate,
      time: normalized.time,
      source: normalized.source,
      todaySortGroup: normalized.todaySortGroup,
      taskKindOption: taskKind,
      owner: normalized.owner,
      status,
      progressPercent: clampedProgress,
      remainingPercent: 100 - clampedProgress,
      isFixed,
      calendarColor: normalized.calendarColor,
      repeatKind: normalized.repeatKind,
      repeatDaysOfWeek: normalized.repeatDaysOfWeek,
      repeatDayOfMonth: normalized.repeatDayOfMonth,
      isGenerated: normalized.repeatKind !== "none",
      isManuallyEdited: true,
      memo: memo.trim()
    });
  }

  return (
    <form className={styles.editorPanel} onSubmit={handleSubmit}>
      <div className={styles.editorHeader}>
        <div>
          <p className={styles.kicker}>수정</p>
          <h2>{task.title}</h2>
        </div>
      </div>

      <label className={styles.formRow}>
        <span>할일</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      </label>

      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isFixed} onChange={(event) => setIsFixed(event.target.checked)} />
        고정 할일로 등록
      </label>

      <TaskKindFields
        taskKind={taskKind}
        date={date}
        time={time}
        dueDate={dueDate}
        periodStartDate={periodStartDate}
        periodEndDate={periodEndDate}
        repeatKind={repeatKind}
        repeatDaysOfWeek={repeatDaysOfWeek}
        repeatDayOfMonth={repeatDayOfMonth}
        calendarColor={calendarColor}
        onTaskKindChange={handleKindChange}
        onDateChange={setDate}
        onTimeChange={setTime}
        onDueDateChange={setDueDate}
        onPeriodStartDateChange={setPeriodStartDate}
        onPeriodEndDateChange={setPeriodEndDate}
        onRepeatKindChange={setRepeatKind}
        onRepeatDaysChange={setRepeatDaysOfWeek}
        onRepeatDayOfMonthChange={setRepeatDayOfMonth}
        onCalendarColorChange={setCalendarColor}
      />

      <label className={styles.formRow}>
        <span>상태</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
          <option value="planned">계획</option>
          <option value="started">진행 중</option>
          <option value="done">완료</option>
          <option value="postponed">연기</option>
          <option value="cancelled">취소</option>
        </select>
      </label>

      <label className={styles.formRow}>
        <span>메모</span>
        <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={240} />
      </label>

      <div className={styles.progressBox}>
        <span>진행률</span>
        <div className={styles.progressStepper}>
          <button type="button" onClick={() => changeProgress(progress - 10)}>
            -
          </button>
          <input
            aria-label="진행률"
            type="number"
            min="0"
            max="100"
            step="10"
            value={progress}
            onChange={(event) => changeProgress(Number(event.target.value))}
          />
          <button type="button" onClick={() => changeProgress(progress + 10)}>
            +
          </button>
        </div>
      </div>

      <div className={styles.editorFooter}>
        <button type="button" className={styles.deleteButton} onClick={() => onDeleteTask(task.id)}>
          삭제
        </button>
        <button type="submit" className={styles.completeButton}>
          저장
        </button>
      </div>
    </form>
  );
}

function TaskCreateForm({
  selectedDate,
  fixedTaskTags,
  onAddTask
}: {
  selectedDate: string;
  fixedTaskTags: string[];
  onAddTask: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [taskKind, setTaskKind] = useState<TaskKindOption>("today");
  const [date, setDate] = useState(selectedDate);
  const [time, setTime] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [periodStartDate, setPeriodStartDate] = useState(selectedDate);
  const [periodEndDate, setPeriodEndDate] = useState("");
  const [repeatKind, setRepeatKind] = useState<RepeatKind>("none");
  const [repeatDaysOfWeek, setRepeatDaysOfWeek] = useState<number[]>([]);
  const [repeatDayOfMonth, setRepeatDayOfMonth] = useState("");
  const [memo, setMemo] = useState("");
  const [isFixed, setIsFixed] = useState(false);
  const [calendarColor, setCalendarColor] = useState(repeatCalendarColors[0]);

  function handleKindChange(nextKind: TaskKindOption) {
    setTaskKind(nextKind);
    if (nextKind === "repeat" && repeatKind === "none") setRepeatKind("daily");
    if (nextKind !== "repeat") setRepeatKind("none");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const normalized = normalizeScheduleFields(taskKind, {
      selectedDate,
      date,
      time,
      dueDate,
      periodStartDate,
      periodEndDate,
      repeatKind,
      repeatDaysOfWeek,
      repeatDayOfMonth,
      calendarColor
    });

    onAddTask({
      id: `task-${Date.now()}`,
      title: trimmedTitle,
      date: normalized.date,
      dueDate: normalized.dueDate,
      periodStartDate: normalized.periodStartDate,
      periodEndDate: normalized.periodEndDate,
      time: normalized.time,
      source: normalized.source,
      status: "planned",
      priority: "normal",
      todaySortGroup: normalized.todaySortGroup,
      taskKindOption: taskKind,
      owner: normalized.owner,
      postponeCount: 0,
      progressPercent: 0,
      remainingPercent: 100,
      reminderAt: null,
      parentTaskId: null,
      isFixed,
      calendarColor: normalized.calendarColor,
      repeatKind: normalized.repeatKind,
      repeatDaysOfWeek: normalized.repeatDaysOfWeek,
      repeatDayOfMonth: normalized.repeatDayOfMonth,
      isGenerated: normalized.repeatKind !== "none",
      isManuallyEdited: false,
      memo: memo.trim()
    });

    setTitle("");
    setTaskKind("today");
    setDate(selectedDate);
    setTime("");
    setDueDate("");
    setPeriodStartDate(selectedDate);
    setPeriodEndDate("");
    setRepeatKind("none");
    setRepeatDaysOfWeek([]);
    setRepeatDayOfMonth("");
    setMemo("");
    setIsFixed(false);
    setCalendarColor(repeatCalendarColors[0]);
  }

  return (
    <form className={styles.createPanel} onSubmit={handleSubmit}>
      <label className={styles.formRow}>
        <span>할일</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 운동하기" maxLength={80} />
      </label>

      {fixedTaskTags.length > 0 && (
        <div className={styles.tagBox} aria-label="고정 할일 태그">
          {fixedTaskTags.map((tag) => (
            <button key={tag} type="button" onClick={() => setTitle(tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}

      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isFixed} onChange={(event) => setIsFixed(event.target.checked)} />
        고정 할일로 등록
      </label>

      <TaskKindFields
        taskKind={taskKind}
        date={date}
        time={time}
        dueDate={dueDate}
        periodStartDate={periodStartDate}
        periodEndDate={periodEndDate}
        repeatKind={repeatKind}
        repeatDaysOfWeek={repeatDaysOfWeek}
        repeatDayOfMonth={repeatDayOfMonth}
        calendarColor={calendarColor}
        onTaskKindChange={handleKindChange}
        onDateChange={setDate}
        onTimeChange={setTime}
        onDueDateChange={setDueDate}
        onPeriodStartDateChange={setPeriodStartDate}
        onPeriodEndDateChange={setPeriodEndDate}
        onRepeatKindChange={setRepeatKind}
        onRepeatDaysChange={setRepeatDaysOfWeek}
        onRepeatDayOfMonthChange={setRepeatDayOfMonth}
        onCalendarColorChange={setCalendarColor}
      />

      <label className={styles.formRow}>
        <span>메모</span>
        <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={240} />
      </label>

      <button type="submit" className={styles.completeButton}>
        등록
      </button>
    </form>
  );
}

function ScheduleCreateForm({ selectedDate, onAddTask }: { selectedDate: string; onAddTask: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [time, setTime] = useState("");
  const [isDday, setIsDday] = useState(false);

  useEffect(() => {
    setDate(selectedDate);
    setEndDate(selectedDate);
  }, [selectedDate]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    onAddTask(createCalendarTask({ title: trimmedTitle, startDate: date, endDate, time, isDday }));
    setTitle("");
    setTime("");
    setIsDday(false);
  }

  return (
    <form className={styles.createPanel} onSubmit={handleSubmit}>
      <label className={styles.formRow}>
        <span>{isDday ? "D-day 제목" : "일정 제목"}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 병원 예약" maxLength={80} />
      </label>
      <div className={styles.formGrid}>
        <label className={styles.formRow}>
          <span>{isDday ? "마감일" : "시작일"}</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>종료일</span>
          <input type="date" value={endDate} disabled={isDday} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>시간</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isDday} onChange={(event) => setIsDday(event.target.checked)} />
        D-day로 표시
      </label>
      <button type="submit" className={styles.completeButton}>
        일정 등록
      </button>
    </form>
  );
}

type TaskKindFieldsProps = {
  taskKind: TaskKindOption;
  date: string;
  time: string;
  dueDate: string;
  periodStartDate: string;
  periodEndDate: string;
  repeatKind: RepeatKind;
  repeatDaysOfWeek: number[];
  repeatDayOfMonth: string;
  calendarColor: string;
  onTaskKindChange: (taskKind: TaskKindOption) => void;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  onDueDateChange: (date: string) => void;
  onPeriodStartDateChange: (date: string) => void;
  onPeriodEndDateChange: (date: string) => void;
  onRepeatKindChange: (repeatKind: RepeatKind) => void;
  onRepeatDaysChange: (days: number[]) => void;
  onRepeatDayOfMonthChange: (day: string) => void;
  onCalendarColorChange: (color: string) => void;
};

function TaskKindFields({
  taskKind,
  date,
  time,
  dueDate,
  periodStartDate,
  periodEndDate,
  repeatKind,
  repeatDaysOfWeek,
  repeatDayOfMonth,
  calendarColor,
  onTaskKindChange,
  onDateChange,
  onTimeChange,
  onDueDateChange,
  onPeriodStartDateChange,
  onPeriodEndDateChange,
  onRepeatKindChange,
  onRepeatDaysChange,
  onRepeatDayOfMonthChange,
  onCalendarColorChange
}: TaskKindFieldsProps) {
  return (
    <section className={styles.kindBox}>
      <div className={styles.kindGrid} role="radiogroup" aria-label="일정 종류">
        {kindOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={taskKind === option.id}
            className={taskKind === option.id ? `${styles.kindButton} ${styles.selectedKind}` : styles.kindButton}
            onClick={() => onTaskKindChange(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      {taskKind === "no_deadline" && <p className={styles.fieldHint}>날짜 없이 보관되는 할일입니다.</p>}

      {taskKind === "today" && (
        <div className={styles.formGrid}>
          <label className={styles.formRow}>
            <span>날짜</span>
            <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
          </label>
          <label className={styles.formRow}>
            <span>시간</span>
            <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
          </label>
        </div>
      )}

      {taskKind === "dday" && (
        <div className={styles.formGrid}>
          <label className={styles.formRow}>
            <span>마감일</span>
            <input type="date" value={dueDate} onChange={(event) => onDueDateChange(event.target.value)} />
          </label>
          <label className={styles.formRow}>
            <span>시작시간</span>
            <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
          </label>
        </div>
      )}

      {taskKind === "repeat" && (
        <>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>진행 기간 시작</span>
              <input type="date" value={periodStartDate} onChange={(event) => onPeriodStartDateChange(event.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>진행 기간 종료</span>
              <input type="date" value={periodEndDate} onChange={(event) => onPeriodEndDateChange(event.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>시작시간</span>
              <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
            </label>
          </div>

          <RepeatFields
            repeatKind={repeatKind}
            repeatDaysOfWeek={repeatDaysOfWeek}
            repeatDayOfMonth={repeatDayOfMonth}
            onRepeatKindChange={onRepeatKindChange}
            onRepeatDaysChange={onRepeatDaysChange}
            onRepeatDayOfMonthChange={onRepeatDayOfMonthChange}
          />

          <fieldset className={styles.colorField}>
            <legend>달력 색상</legend>
            <div className={styles.colorGrid}>
              {repeatCalendarColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`반복 색상 ${color}`}
                  className={calendarColor === color ? `${styles.colorSwatch} ${styles.selectedColor}` : styles.colorSwatch}
                  style={{ backgroundColor: color }}
                  onClick={() => onCalendarColorChange(color)}
                />
              ))}
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
}

function RepeatFields({
  repeatKind,
  repeatDaysOfWeek,
  repeatDayOfMonth,
  onRepeatKindChange,
  onRepeatDaysChange,
  onRepeatDayOfMonthChange
}: {
  repeatKind: RepeatKind;
  repeatDaysOfWeek: number[];
  repeatDayOfMonth: string;
  onRepeatKindChange: (repeatKind: RepeatKind) => void;
  onRepeatDaysChange: (days: number[]) => void;
  onRepeatDayOfMonthChange: (day: string) => void;
}) {
  function toggleDay(day: number) {
    if (repeatDaysOfWeek.includes(day)) {
      onRepeatDaysChange(repeatDaysOfWeek.filter((value) => value !== day));
      return;
    }
    onRepeatDaysChange([...repeatDaysOfWeek, day].sort());
  }

  return (
    <section className={styles.repeatBox}>
      <label className={styles.formRow}>
        <span>반복</span>
        <select value={repeatKind} onChange={(event) => onRepeatKindChange(event.target.value as RepeatKind)}>
          <option value="daily">매일</option>
          <option value="weekly">요일 반복</option>
          <option value="date_range">특정 기간</option>
          <option value="monthly">매월</option>
        </select>
      </label>

      {repeatKind === "weekly" && (
        <div className={styles.weekdayGrid} aria-label="반복 요일">
          {[
            ["일", 0],
            ["월", 1],
            ["화", 2],
            ["수", 3],
            ["목", 4],
            ["금", 5],
            ["토", 6]
          ].map(([label, value]) => (
            <button
              key={value}
              type="button"
              className={repeatDaysOfWeek.includes(Number(value)) ? styles.selectedWeekday : ""}
              onClick={() => toggleDay(Number(value))}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {repeatKind === "monthly" && (
        <label className={styles.formRow}>
          <span>매월 반복일</span>
          <input
            type="number"
            min="1"
            max="31"
            value={repeatDayOfMonth}
            onChange={(event) => onRepeatDayOfMonthChange(event.target.value)}
          />
        </label>
      )}
    </section>
  );
}

function getTasksForDate(tasks: Task[], date: string) {
  return tasks.filter((task) => {
    if (task.date === date) return true;
    if (task.date === null && task.source === "no_date") return true;
    if (matchesRepeat(task, date)) return true;
    if (task.dueDate && daysBetween(date, task.dueDate) >= 0 && daysBetween(date, task.dueDate) <= 3) return true;
    return false;
  });
}

function getFixedTaskTags(tasks: Task[]) {
  return Array.from(
    new Set(
      tasks
        .filter((task) => task.isFixed)
        .map((task) => task.title.trim())
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function getRepeatTrackers(tasks: Task[]) {
  return tasks.filter(isRepeatTask);
}

function getCalendarTextTasks(tasks: Task[], date: string) {
  return tasks
    .filter((task) => {
      if (isRepeatTask(task) || task.source === "no_date") return false;
      return (
        task.date === date ||
        task.dueDate === date ||
        Boolean(task.periodStartDate && task.periodEndDate && date >= task.periodStartDate && date <= task.periodEndDate)
      );
    })
    .sort((a, b) => {
      const timeDiff = (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
      if (timeDiff !== 0) return timeDiff;
      return a.title.localeCompare(b.title, "ko-KR");
    });
}

function getCalendarProgressTasks(tasks: Task[], date: string) {
  return getTasksForDate(tasks, date).filter((task) => task.source !== "no_date");
}

function createCalendarTask({
  title,
  startDate,
  endDate,
  time,
  isDday
}: {
  title: string;
  startDate: string;
  endDate: string;
  time: string;
  isDday: boolean;
}): Task {
  const normalizedEndDate = endDate >= startDate ? endDate : startDate;
  const isPeriod = !isDday && normalizedEndDate !== startDate;

  return {
    id: `task-${Date.now()}`,
    title,
    date: isDday || isPeriod ? null : startDate,
    dueDate: isDday ? startDate : null,
    periodStartDate: isPeriod ? startDate : null,
    periodEndDate: isPeriod ? normalizedEndDate : null,
    time: time || null,
    source: isDday ? "deadline" : "manual",
    status: "planned",
    priority: "normal",
    todaySortGroup: time ? "timed_today" : isDday ? "near_deadline" : "pulled_to_today",
    taskKindOption: isDday ? "dday" : "today",
    postponeCount: 0,
    progressPercent: 0,
    remainingPercent: 100,
    reminderAt: null,
    parentTaskId: null,
    calendarColor: isDday ? fixedKindColors.dday : fixedKindColors.today,
    owner: "schedule",
    repeatKind: "none",
    repeatDaysOfWeek: [],
    repeatDayOfMonth: null,
    completedDates: [],
    isGenerated: false,
    isManuallyEdited: false,
    memo: ""
  };
}

function normalizeScheduleFields(
  taskKind: TaskKindOption,
  values: {
    selectedDate: string;
    date: string;
    time: string;
    dueDate: string;
    periodStartDate: string;
    periodEndDate: string;
    repeatKind: RepeatKind;
    repeatDaysOfWeek: number[];
    repeatDayOfMonth: string;
    calendarColor: string;
  }
): {
  date: string | null;
  dueDate: string | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
  time: string | null;
  source: TaskSource;
  todaySortGroup: TodaySortGroup;
  owner: TaskOwner;
  calendarColor: string;
  repeatKind: RepeatKind;
  repeatDaysOfWeek: number[];
  repeatDayOfMonth: number | null;
} {
  if (taskKind === "no_deadline") {
    return {
      date: null,
      dueDate: null,
      periodStartDate: null,
      periodEndDate: null,
      time: null,
      source: "no_date",
      todaySortGroup: "no_date",
      owner: "task",
      calendarColor: fixedKindColors.no_deadline,
      repeatKind: "none",
      repeatDaysOfWeek: [],
      repeatDayOfMonth: null
    };
  }

  if (taskKind === "dday") {
    return {
      date: null,
      dueDate: values.dueDate || values.selectedDate,
      periodStartDate: null,
      periodEndDate: null,
      time: values.time || null,
      source: "deadline",
      todaySortGroup: values.time ? "timed_today" : "near_deadline",
      owner: "schedule",
      calendarColor: fixedKindColors.dday,
      repeatKind: "none",
      repeatDaysOfWeek: [],
      repeatDayOfMonth: null
    };
  }

  if (taskKind === "repeat") {
    const nextRepeatKind = values.repeatKind === "none" ? "daily" : values.repeatKind;
    return {
      date: values.periodStartDate || values.selectedDate,
      dueDate: null,
      periodStartDate: values.periodStartDate || values.selectedDate,
      periodEndDate: values.periodEndDate || null,
      time: values.time || null,
      source: "routine",
      todaySortGroup: "repeat_today",
      owner: "task",
      calendarColor: values.calendarColor,
      repeatKind: nextRepeatKind,
      repeatDaysOfWeek: nextRepeatKind === "weekly" ? values.repeatDaysOfWeek : [],
      repeatDayOfMonth: nextRepeatKind === "monthly" && values.repeatDayOfMonth ? Number(values.repeatDayOfMonth) : null
    };
  }

  return {
    date: values.date || values.selectedDate,
    dueDate: null,
    periodStartDate: null,
    periodEndDate: null,
    time: values.time || null,
    source: "manual",
    todaySortGroup: values.time ? "timed_today" : "pulled_to_today",
    owner: "task",
    calendarColor: fixedKindColors.today,
    repeatKind: "none",
    repeatDaysOfWeek: [],
    repeatDayOfMonth: null
  };
}

function getTaskKindOption(task: Task): TaskKindOption {
  if (task.taskKindOption) return task.taskKindOption;
  if (task.repeatKind && task.repeatKind !== "none") return "repeat";
  if (task.dueDate) return "dday";
  if (!task.date) return "no_deadline";
  return "today";
}

function isRepeatTask(task: Task) {
  return task.taskKindOption === "repeat" || Boolean(task.repeatKind && task.repeatKind !== "none");
}

function isSchedulerOwnedTask(task: Task) {
  return task.owner === "schedule" || task.taskKindOption === "dday" || task.source === "deadline";
}

function isTaskDoneOnDate(task: Task, date: string) {
  if (isRepeatTask(task)) {
    return Boolean(task.completedDates?.includes(date));
  }

  return task.status === "done";
}

function normalizeRepeatKind(repeatKind: RepeatKind | undefined) {
  if (!repeatKind || repeatKind === "none") return "none";
  return repeatKind;
}

function matchesRepeat(task: Task, date: string) {
  if (!task.repeatKind || task.repeatKind === "none") return false;

  if (task.periodStartDate && date < task.periodStartDate) return false;
  if (task.periodEndDate && date > task.periodEndDate) return false;

  const current = new Date(`${date}T00:00:00`);

  if (task.repeatKind === "daily" || task.repeatKind === "date_range") return true;

  if (task.repeatKind === "weekly") {
    return Boolean(task.repeatDaysOfWeek?.includes(current.getDay()));
  }

  if (task.repeatKind === "monthly") {
    return task.repeatDayOfMonth === current.getDate();
  }

  return false;
}

function formatDateTitle(date: string) {
  const today = "2026-06-02";
  if (date === today) return "오늘";
  if (date === shiftDate(today, -1)) return "어제";
  if (date === shiftDate(today, 1)) return "내일";

  return new Date(`${date}T00:00:00`).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function formatDateHeading(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function shiftDate(date: string, amount: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + amount);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRepeatProgressDates(task: Task, selectedDate: string) {
  const selectedMonth = new Date(`${selectedDate}T00:00:00`);
  const monthStart = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth() + 1).padStart(2, "0")}-${String(
    getLastDayOfMonth(selectedMonth.getFullYear(), selectedMonth.getMonth())
  ).padStart(2, "0")}`;
  const scheduleStart = task.periodStartDate ?? task.date ?? monthStart;
  const startDate = task.periodEndDate ? scheduleStart : maxDate(scheduleStart, monthStart);
  const endDate = task.periodEndDate ?? monthEnd;
  if (startDate > endDate) return [];

  const days: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    if (matchesRepeat(task, cursor)) {
      days.push(cursor);
    }
    cursor = shiftDate(cursor, 1);
  }

  return days;
}

function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

function shiftMonth(date: string, amount: number) {
  const current = new Date(`${date}T00:00:00`);
  const originalDay = current.getDate();
  current.setDate(1);
  current.setMonth(current.getMonth() + amount);
  const year = current.getFullYear();
  const month = current.getMonth();
  const day = Math.min(originalDay, getLastDayOfMonth(year, month));
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getMonthDays(date: string) {
  const current = new Date(`${date}T00:00:00`);
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDay = getLastDayOfMonth(year, month);
  const days: Array<string | null> = Array.from({ length: firstDay }, () => null);

  for (let day = 1; day <= lastDay; day += 1) {
    days.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function daysBetween(from: string, to: string) {
  const fromTime = new Date(`${from}T00:00:00`).getTime();
  const toTime = new Date(`${to}T00:00:00`).getTime();
  return Math.round((toTime - fromTime) / 86_400_000);
}

function formatDday(baseDate: string, dueDate: string) {
  const diff = daysBetween(baseDate, dueDate);
  if (diff === 0) return "D-Day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function getDeadlineClass(baseDate: string, dueDate: string) {
  const diff = daysBetween(baseDate, dueDate);
  if (diff >= 0 && diff <= 2) return styles.deadlineHot;
  if (diff >= 0 && diff <= 5) return styles.deadlineWarm;
  return "";
}

function formatReminderTime(reminderAt: string) {
  return new Date(reminderAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatReminderLabel(task: Task) {
  if (task.reminderAt) return `${formatReminderTime(task.reminderAt)} 알림`;
  if (task.time) return `${task.time} 알림`;
  return "";
}

function CalendarTab({
  tasks,
  selectedDate,
  onDateChange,
  onOpenTasks
}: {
  tasks: Task[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  onOpenTasks: () => void;
}) {
  const monthDays = getMonthDays(selectedDate);
  const monthTitle = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long"
  });

  function openDate(date: string) {
    onDateChange(date);
    onOpenTasks();
  }

  return (
    <section className={styles.mainPanel}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleNav} aria-label="월 이동">
          <button type="button" aria-label="이전 달" onClick={() => onDateChange(shiftMonth(selectedDate, -1))}>
            &lt;
          </button>
          <h2>{monthTitle}</h2>
          <button type="button" aria-label="다음 달" onClick={() => onDateChange(shiftMonth(selectedDate, 1))}>
            &gt;
          </button>
        </div>
      </div>
      <p className={styles.placeholderText}>반복은 실제 완료한 날만 색칠하고, 일반 일정은 날짜 칸에 텍스트로 표시합니다.</p>

      <div className={styles.calendarGrid} aria-label={`${monthTitle} 달력`}>
        {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
          <div key={label} className={label === "일" ? `${styles.calendarDow} ${styles.sunday}` : styles.calendarDow}>
            {label}
          </div>
        ))}
        {monthDays.map((day, index) => {
          if (!day) return <div key={`blank-${index}`} className={`${styles.calendarCell} ${styles.blankCell}`} />;

          const dayTasks = getCalendarTextTasks(tasks, day);
          const progressTasks = getCalendarProgressTasks(tasks, day);
          const progressDoneCount = progressTasks.filter((task) => isTaskDoneOnDate(task, day)).length;
          const progressRate = progressTasks.length === 0 ? 0 : Math.round((progressDoneCount / progressTasks.length) * 100);
          const isDayComplete = progressTasks.length > 0 && progressDoneCount === progressTasks.length;
          const isSelected = day === selectedDate;
          const date = new Date(`${day}T00:00:00`);

          return (
            <button
              key={day}
              type="button"
              className={[
                styles.calendarCell,
                isSelected ? styles.selectedCell : "",
                isDayComplete ? styles.completedCell : ""
              ].join(" ")}
              onClick={() => openDate(day)}
            >
              <span className={date.getDay() === 0 ? `${styles.calendarDay} ${styles.sunday}` : styles.calendarDay}>
                {date.getDate()}
              </span>
              {progressTasks.length > 0 && (
                <span className={styles.calendarStats} aria-label={`일정 ${progressTasks.length}개, 진척률 ${progressRate}%`}>
                  {progressTasks.length} · {progressRate}%
                </span>
              )}
              <span className={styles.calendarTextList}>
                {dayTasks.slice(0, 3).map((task) => (
                  <span key={task.id} className={task.dueDate === day ? styles.calendarDeadlineText : ""}>
                    {task.time ? `${task.time} ` : ""}
                    {task.dueDate === day ? `${formatDday(day, task.dueDate)} ` : ""}
                    {task.title}
                  </span>
                ))}
                {dayTasks.length > 3 && <span>+{dayTasks.length - 3}</span>}
              </span>
              {progressTasks.length > 0 && (
                <span className={styles.calendarBar} aria-label={`진척률 ${progressDoneCount}/${progressTasks.length}`}>
                  <i style={{ width: `${progressRate}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WordsTab({ isActive }: { isActive: boolean }) {
  const [wordProgress, setWordProgress] = useState<WordProgressRecord[]>(() => loadWordProgress());
  const [dailyWordCount, setDailyWordCount] = useState(20);
  const [deck, setDeck] = useState(() => buildWordDeck(20, loadWordProgress()));
  const [wordPhase, setWordPhase] = useState<"study" | "quiz">("study");
  const [wordIndex, setWordIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [quizType, setQuizType] = useState<"meaning" | "spelling">("meaning");
  const [selectedMeaning, setSelectedMeaning] = useState("");
  const [typedAnswer, setTypedAnswer] = useState("");
  const [checkedMeaning, setCheckedMeaning] = useState<"correct" | "wrong" | null>(null);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [reviewWords, setReviewWords] = useState<string[]>([]);
  const [studiedResults, setStudiedResults] = useState<Array<{ en: string; result: "studied" | "correct" | "wrong" }>>([]);
  const [showLearnedWords, setShowLearnedWords] = useState(false);
  const currentWord = deck[wordIndex];
  const isFinished = wordPhase === "quiz" && wordIndex >= deck.length;
  const progressRate = deck.length === 0 ? 0 : Math.round((wordIndex / deck.length) * 100);
  const learnedWordCount = wordProgress.filter((record) => record.seenCount > 0).length;
  const progressedWordItems = studiedResults
    .map((result) => {
      const word = seedWords.find((item) => item.en === result.en);
      return word ? { ...word, result: result.result } : null;
    })
    .filter((word): word is (typeof seedWords)[number] & { result: "studied" | "correct" | "wrong" } => Boolean(word));
  const meaningOptions = useMemo(() => {
    if (!currentWord) return [];
    const otherMeanings = shuffleWords(seedWords.filter((word) => word.en !== currentWord.en))
      .slice(0, 3)
      .map((word) => word.ko);
    return shuffleWords([currentWord.ko, ...otherMeanings]);
  }, [currentWord]);

  useEffect(() => {
    saveWordProgress(wordProgress);
  }, [wordProgress]);

  function extendDeck(currentDeck: typeof seedWords, count: number) {
    const currentWords = new Set(currentDeck.map((word) => word.en));
    const extraWords = buildWordDeck(count + currentDeck.length, wordProgress, currentWords).slice(0, count);
    return [...currentDeck, ...extraWords];
  }

  function resizeDailyDeck(count: number) {
    const safeCount = clampTimerValue(count, 1, seedWords.length);
    setDailyWordCount(safeCount);
    setDeck((currentDeck) => {
      const protectedCount = Math.min(currentDeck.length, getProtectedWordCount(wordPhase, wordIndex));
      if (safeCount <= protectedCount) return currentDeck.slice(0, protectedCount);
      if (safeCount <= currentDeck.length) return currentDeck.slice(0, safeCount);

      return extendDeck(currentDeck, safeCount - currentDeck.length);
    });
  }

  function restart(count = dailyWordCount) {
    const safeCount = clampTimerValue(count, 1, seedWords.length);
    setDailyWordCount(safeCount);
    setDeck(buildWordDeck(safeCount, wordProgress));
    setWordPhase("study");
    setWordIndex(0);
    setIsFlipped(false);
    setSelectedMeaning("");
    setTypedAnswer("");
    setCheckedMeaning(null);
    setKnownWords([]);
    setReviewWords([]);
    setStudiedResults([]);
  }

  function restartReviewOnly() {
    const reviewDeck = deck.filter((word) => reviewWords.includes(word.en));
    setDeck(reviewDeck.length > 0 ? shuffleWords(reviewDeck) : buildWordDeck(dailyWordCount, wordProgress));
    setWordPhase("study");
    setWordIndex(0);
    setIsFlipped(false);
    setSelectedMeaning("");
    setTypedAnswer("");
    setCheckedMeaning(null);
    setKnownWords([]);
    setReviewWords([]);
    setStudiedResults([]);
  }

  function goNextStudyWord() {
    if (!currentWord) return;
    setStudiedResults((current) => upsertStudiedResult(current, currentWord.en, "studied"));
    setIsFlipped(false);
    if (wordIndex + 1 >= deck.length) {
      setWordPhase("quiz");
      setWordIndex(0);
      return;
    }
    setWordIndex((current) => current + 1);
  }

  function checkMeaning() {
    if (!currentWord) return;
    const normalizedTypedAnswer = typedAnswer.trim().toLowerCase();
    const isCorrect =
      quizType === "meaning"
        ? selectedMeaning === currentWord.ko
        : normalizedTypedAnswer.length > 0 && normalizedTypedAnswer === currentWord.en.toLowerCase();
    if (quizType === "meaning" && !selectedMeaning) return;
    if (quizType === "spelling" && !normalizedTypedAnswer) return;
    setCheckedMeaning(isCorrect ? "correct" : "wrong");
    setIsFlipped(true);
    setWordProgress((current) => updateWordProgress(current, currentWord.en, isCorrect ? "correct" : "wrong"));
    if (isCorrect) {
      setKnownWords((current) => [...current, currentWord.en]);
      setStudiedResults((current) => upsertStudiedResult(current, currentWord.en, "correct"));
    } else {
      setReviewWords((current) => [...current, currentWord.en]);
      setStudiedResults((current) => upsertStudiedResult(current, currentWord.en, "wrong"));
    }
  }

  function goNextWord() {
    setIsFlipped(false);
    setSelectedMeaning("");
    setTypedAnswer("");
    setCheckedMeaning(null);
    window.setTimeout(() => setWordIndex((current) => current + 1), 140);
  }

  function speakWord(word: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.86;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className={styles.mainPanel} hidden={!isActive}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>단어 외우기</h2>
        </div>
        <label className={styles.wordCountControl}>
          <span>오늘</span>
          <input
            type="number"
            min="1"
            value={dailyWordCount}
            onChange={(event) => resizeDailyDeck(Number(event.target.value))}
          />
          <span>개</span>
        </label>
      </div>

      {!isFinished && currentWord ? (
        <div className={styles.flashWrap}>
          <div className={styles.flashCounter}>{wordIndex + 1} / {deck.length}</div>
          <div className={styles.flashProgress}>
            <i style={{ width: `${progressRate}%` }} />
          </div>
          <button
            type="button"
            className={`${styles.flashCard} ${isFlipped ? styles.flippedCard : ""}`}
            onClick={() => {
              if (wordPhase === "study" || checkedMeaning) setIsFlipped((current) => !current);
            }}
          >
            <span className={styles.flashFace}>
              <span
                role="button"
                tabIndex={0}
                className={styles.speakButton}
                aria-label={`${currentWord.en} 발음 듣기`}
                onClick={(event) => {
                  event.stopPropagation();
                  speakWord(currentWord.en);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  speakWord(currentWord.en);
                }}
              >
                sound
              </span>
              <i>{currentWord.pos}</i>
              <strong>{currentWord.en}</strong>
              <em>{wordPhase === "study" ? "카드를 눌러 뜻과 예문을 확인하세요." : "알맞은 뜻을 고른 뒤 확인하세요."}</em>
            </span>
            <span className={`${styles.flashFace} ${styles.flashBack}`}>
              <span
                role="button"
                tabIndex={0}
                className={styles.speakButton}
                aria-label={`${currentWord.en} 발음 듣기`}
                onClick={(event) => {
                  event.stopPropagation();
                  speakWord(currentWord.en);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  speakWord(currentWord.en);
                }}
              >
                sound
              </span>
              <strong>{currentWord.ko}</strong>
              <em>{wordPhase === "study" ? currentWord.ex : `${checkedMeaning === "correct" ? "맞았어요." : "다음에 다시 볼 단어예요."} ${currentWord.ex}`}</em>
            </span>
          </button>
          {wordPhase === "quiz" && (
            <>
              <div className={styles.quizTypeSwitch} aria-label="퀴즈 종류">
                <button type="button" className={quizType === "meaning" ? styles.activePomoMode : ""} disabled={Boolean(checkedMeaning)} onClick={() => setQuizType("meaning")}>
                  뜻 고르기
                </button>
                <button type="button" className={quizType === "spelling" ? styles.activePomoMode : ""} disabled={Boolean(checkedMeaning)} onClick={() => setQuizType("spelling")}>
                  영어 입력
                </button>
              </div>
              {quizType === "meaning" ? (
                <div className={styles.meaningGrid} aria-label="뜻 선택">
                  {meaningOptions.map((meaning) => (
                    <button
                      key={meaning}
                      type="button"
                      disabled={Boolean(checkedMeaning)}
                      className={[
                        selectedMeaning === meaning ? styles.selectedMeaning : "",
                        checkedMeaning && meaning === currentWord.ko ? styles.correctMeaning : "",
                        checkedMeaning === "wrong" && selectedMeaning === meaning ? styles.wrongMeaning : ""
                      ].join(" ")}
                      onClick={() => setSelectedMeaning(meaning)}
                    >
                      {meaning}
                    </button>
                  ))}
                </div>
              ) : (
                <label className={styles.spellingQuiz}>
                  <span>{currentWord.ko}</span>
                  <input
                    value={typedAnswer}
                    disabled={Boolean(checkedMeaning)}
                    placeholder="영어 단어 입력"
                    onChange={(event) => setTypedAnswer(event.target.value)}
                  />
                  {checkedMeaning === "wrong" && <em>정답: {currentWord.en}</em>}
                </label>
              )}
            </>
          )}
          <div className={styles.flashActions}>
            {wordPhase === "study" ? (
              <button type="button" onClick={goNextStudyWord}>
                {wordIndex + 1 >= deck.length ? "퀴즈 시작하기" : "다음 단어 확인하기"}
              </button>
            ) : checkedMeaning ? (
              <button type="button" onClick={goNextWord}>다음</button>
            ) : (
              <button type="button" disabled={quizType === "meaning" ? !selectedMeaning : !typedAnswer.trim()} onClick={checkMeaning}>확인</button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.vocabDone}>
          <strong>학습 완료</strong>
          <span>오늘 {deck.length}개 · 맞음 {knownWords.length} · 다시 볼 단어 {reviewWords.length} · 누적 {learnedWordCount}개</span>
          <div className={styles.flashActions}>
            {reviewWords.length > 0 && <button type="button" onClick={restartReviewOnly}>복습만 다시</button>}
            <button type="button" onClick={() => restart()}>새로 시작</button>
          </div>
        </div>
      )}
      <div className={styles.learnedWordsPanel}>
        <button type="button" onClick={() => setShowLearnedWords((current) => !current)}>
          {showLearnedWords ? "진행 단어 닫기" : `진행 단어 ${studiedResults.length}개`}
        </button>
        {showLearnedWords && (
          <div className={styles.learnedWordsList}>
            {progressedWordItems.length > 0 ? (
              progressedWordItems.map((word) => (
                <span key={word.en}>
                  <strong>{word.en}</strong>
                  <em>{word.ko}</em>
                  {word.result === "correct" && <b className={styles.correctWordMark}>맞음</b>}
                  {word.result === "wrong" && <b className={styles.wrongWordMark}>틀림</b>}
                  {word.result === "studied" && <b>학습</b>}
                </span>
              ))
            ) : (
              <p>아직 진행한 단어가 없어요.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PomodoroTab({ tasks, selectedDate, isActive }: { tasks: Task[]; selectedDate: string; isActive: boolean }) {
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [targetSets, setTargetSets] = useState(4);
  const [completedSets, setCompletedSets] = useState(0);
  const [timerMode, setTimerMode] = useState<"idle" | "focus" | "break">("idle");
  const [timerPreset, setTimerPreset] = useState<"focus" | "break">("focus");
  const [remainingSeconds, setRemainingSeconds] = useState(focusMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState("");
  const isEditingSettings = timerMode === "idle";
  const isBreakTimer = timerMode === "break" || (timerMode === "idle" && timerPreset === "break");
  const totalSeconds = isBreakTimer ? breakMinutes * 60 : focusMinutes * 60;
  const progressRate = totalSeconds <= 0 ? 0 : 1 - remainingSeconds / totalSeconds;
  const timerLabel = isBreakTimer ? "휴식" : "집중";
  const focusCandidates = tasks.filter((task) => !isTaskDoneOnDate(task, selectedDate) && task.status !== "cancelled");

  useEffect(() => {
    if (isActive) return;
    if (timerMode !== "focus") return;
    setIsRunning(false);
  }, [isActive, timerMode]);

  useEffect(() => {
    if (!isEditingSettings) return;
    setRemainingSeconds(timerPreset === "break" ? breakMinutes * 60 : focusMinutes * 60);
  }, [breakMinutes, focusMinutes, isEditingSettings, timerPreset]);

  useEffect(() => {
    if (!isRunning) return;

    const timerId = window.setInterval(() => {
      setRemainingSeconds((current) => {
        if (current > 1) return current - 1;

        setIsRunning(false);
        if (timerMode === "focus") {
          setCompletedSets((currentSet) => Math.min(targetSets, currentSet + 1));
          window.setTimeout(() => window.alert("집중 시간이 끝났어요."), 0);
        }
        if (timerMode === "break") {
          window.setTimeout(() => window.alert("휴식 시간이 끝났어요."), 0);
        }
        setTimerMode("idle");
        return 0;
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [breakMinutes, focusMinutes, isRunning, targetSets, timerMode]);

  function updateFocusMinutes(value: number) {
    setFocusMinutes(clampTimerValue(value, 1, 180));
  }

  function updateBreakMinutes(value: number) {
    setBreakMinutes(clampTimerValue(value, 1, 60));
  }

  function updateTargetSets(value: number) {
    setTargetSets(clampTimerValue(value, 1, 12));
  }

  function startFocus() {
    setTimerPreset("focus");
    setTimerMode("focus");
    setRemainingSeconds(focusMinutes * 60);
    setIsRunning(true);
  }

  function startBreak() {
    setTimerPreset("break");
    setTimerMode("break");
    setRemainingSeconds(breakMinutes * 60);
    setIsRunning(true);
  }

  function resetTimer() {
    setTimerMode("idle");
    setCompletedSets(0);
    setRemainingSeconds(timerPreset === "break" ? breakMinutes * 60 : focusMinutes * 60);
    setIsRunning(false);
  }

  function startSelectedPreset() {
    if (remainingSeconds === 0) {
      setRemainingSeconds(timerPreset === "break" ? breakMinutes * 60 : focusMinutes * 60);
    }
    if (timerPreset === "break") {
      startBreak();
      return;
    }
    startFocus();
  }

  return (
    <section className={styles.mainPanel} hidden={!isActive}>
      <h2>타이머</h2>
      <div className={styles.pomodoroPanel}>
        <div className={styles.pomoModes} aria-label="타이머 모드">
          <button
            type="button"
            className={!isBreakTimer ? styles.activePomoMode : ""}
            onClick={() => {
              if (!isEditingSettings) return;
              setTimerPreset("focus");
              setRemainingSeconds(focusMinutes * 60);
            }}
          >
            집중
          </button>
          <button
            type="button"
            className={isBreakTimer ? styles.activePomoMode : ""}
            onClick={() => {
              if (!isEditingSettings) return;
              setTimerPreset("break");
              setRemainingSeconds(breakMinutes * 60);
            }}
          >
            휴식
          </button>
        </div>

        <div className={styles.timerDisplay} aria-live="polite">
          <div className={`${styles.timerCircle} ${isRunning && timerMode === "focus" ? styles.breathingTimer : ""}`}>
            <PomoRing progress={progressRate} />
            <div className={styles.timerCircleInner}>
              <strong>{formatTimerSeconds(remainingSeconds)}</strong>
              <span>{timerLabel}</span>
            </div>
          </div>
        </div>

        <div className={styles.timerSettings}>
          <label>
            <span>집중</span>
            <input
              type="number"
              min="1"
              max="180"
              value={focusMinutes}
              disabled={!isEditingSettings}
              onChange={(event) => updateFocusMinutes(Number(event.target.value))}
            />
            <em>분</em>
          </label>
          <label>
            <span>휴식</span>
            <input
              type="number"
              min="1"
              max="60"
              value={breakMinutes}
              disabled={!isEditingSettings}
              onChange={(event) => updateBreakMinutes(Number(event.target.value))}
            />
            <em>분</em>
          </label>
          <label>
            <span>반복</span>
            <input
              type="number"
              min="1"
              max="12"
              value={targetSets}
              disabled={!isEditingSettings}
              onChange={(event) => updateTargetSets(Number(event.target.value))}
            />
            <em>회</em>
          </label>
        </div>

        <div className={styles.timerActions}>
          {timerMode === "idle" && (
            <>
              <button type="button" onClick={startSelectedPreset}>{remainingSeconds === 0 ? "다시 시작" : "시작"}</button>
              <button type="button" onClick={resetTimer}>리셋</button>
            </>
          )}
          {timerMode === "focus" && (
            <>
              <button type="button" onClick={() => setIsRunning((current) => !current)}>{isRunning ? "잠깐 멈춤" : "다시 시작"}</button>
              <button type="button" onClick={resetTimer}>리셋</button>
            </>
          )}
          {timerMode === "break" && (
            <>
              <button type="button" onClick={() => setIsRunning((current) => !current)}>{isRunning ? "잠깐 멈춤" : "다시 시작"}</button>
              <button type="button" onClick={resetTimer}>리셋</button>
            </>
          )}
        </div>

        <div className={styles.pomoDots}>
          {Array.from({ length: Math.min(targetSets, 12) }).map((_, index) => (
            <span key={index} className={index < completedSets ? styles.activePomoDot : ""} />
          ))}
          <strong>오늘 {completedSets}회 집중</strong>
        </div>

        <label className={styles.pomoFocus}>
          <span>지금 집중할 일</span>
          <select value={focusTaskId} onChange={(event) => setFocusTaskId(event.target.value)}>
            <option value="">선택 안 함</option>
            {focusCandidates.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function MemoTab() {
  const [memos, setMemos] = useState<Memo[]>(() => loadStoredMemos());
  const [content, setContent] = useState("");

  useEffect(() => {
    saveStoredMemos(memos);
  }, [memos]);

  function addMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    setMemos((current) => [
      {
        id: `memo-${Date.now()}`,
        content: trimmedContent,
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
    setContent("");
  }

  function deleteMemo(memoId: string) {
    setMemos((current) => current.filter((memo) => memo.id !== memoId));
  }

  return (
    <section className={styles.mainPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>메모 <span className={styles.titleCount}>{memos.length}</span></h2>
        </div>
      </div>

      <form className={styles.memoComposer} onSubmit={addMemo}>
        <textarea
          value={content}
          maxLength={600}
          placeholder="예: 다음에 병원 예약할 때 필요한 서류 확인하기"
          onChange={(event) => setContent(event.target.value)}
        />
        <button type="submit">메모 추가</button>
      </form>

      <div className={styles.memoList}>
        {memos.length > 0 ? (
          memos.map((memo) => (
            <article key={memo.id} className={styles.memoItem}>
              <p>{memo.content}</p>
              <div>
                <time>{formatMemoTime(memo.createdAt)}</time>
                <button type="button" onClick={() => deleteMemo(memo.id)}>삭제</button>
              </div>
            </article>
          ))
        ) : (
          <p className={styles.emptyMemo}>아직 메모가 없어요.</p>
        )}
      </div>
    </section>
  );
}

function PomoRing({ progress }: { progress: number }) {
  const size = 300;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <svg className={styles.pomoRing} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        className={styles.pomoRingTrack}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <circle
        className={styles.pomoRingProgress}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
}

function formatTimerSeconds(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const restSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

function clampTimerValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function shuffleWords<T>(words: T[]) {
  return [...words].sort(() => Math.random() - 0.5);
}

function buildWordDeck(count: number, progress: WordProgressRecord[], excludeWords = new Set<string>()) {
  const safeCount = clampTimerValue(count, 1, seedWords.length);
  const today = getLocalDateKey();
  const progressMap = new Map(progress.map((record) => [record.en, record]));
  const reviewTargetCount = Math.min(Math.round(safeCount / 3), safeCount);
  const dueReviewWords = seedWords.filter((word) => {
    if (excludeWords.has(word.en)) return false;
    const record = progressMap.get(word.en);
    if (!record || record.seenCount <= 0) return false;
    return record.nextReviewAt <= today;
  });
  const recentReviewWords = seedWords.filter((word) => {
    if (excludeWords.has(word.en)) return false;
    const record = progressMap.get(word.en);
    if (!record || record.seenCount <= 0) return false;
    return daysBetween(record.lastSeenAt ?? today, today) <= 3;
  });
  const newWords = seedWords.filter((word) => !excludeWords.has(word.en) && !progressMap.has(word.en));
  const learnedWords = seedWords.filter((word) => !excludeWords.has(word.en) && progressMap.has(word.en));
  const deck: typeof seedWords = [];

  addUniqueWords(deck, shuffleWords(dueReviewWords), reviewTargetCount);
  addUniqueWords(deck, shuffleWords(recentReviewWords), reviewTargetCount);
  addUniqueWords(deck, shuffleWords(newWords), safeCount);
  addUniqueWords(deck, shuffleWords(learnedWords), safeCount);
  addUniqueWords(deck, shuffleWords(seedWords.filter((word) => !excludeWords.has(word.en))), safeCount);

  return deck.slice(0, safeCount);
}

function addUniqueWords(target: typeof seedWords, source: typeof seedWords, maxCount: number) {
  const existingWords = new Set(target.map((word) => word.en));
  for (const word of source) {
    if (target.length >= maxCount) return;
    if (existingWords.has(word.en)) continue;
    target.push(word);
    existingWords.add(word.en);
  }
}

function getProtectedWordCount(wordPhase: "study" | "quiz", wordIndex: number) {
  if (wordPhase === "study") return wordIndex + 1;
  return Number.POSITIVE_INFINITY;
}

function updateWordProgress(records: WordProgressRecord[], en: string, result: "studied" | "correct" | "wrong") {
  const today = getLocalDateKey();
  const existing = records.find((record) => record.en === en);
  const baseRecord: WordProgressRecord = existing ?? {
    en,
    seenCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lastSeenAt: null,
    nextReviewAt: today,
    lastResult: "studied"
  };
  const updatedRecord: WordProgressRecord = {
    ...baseRecord,
    seenCount: baseRecord.seenCount + 1,
    correctCount: baseRecord.correctCount + (result === "correct" ? 1 : 0),
    wrongCount: baseRecord.wrongCount + (result === "wrong" ? 1 : 0),
    lastSeenAt: today,
    nextReviewAt: scheduleNextWordReview(today, result, baseRecord.correctCount, baseRecord.wrongCount),
    lastResult: result
  };

  if (!existing) return [...records, updatedRecord];
  return records.map((record) => (record.en === en ? updatedRecord : record));
}

function scheduleNextWordReview(today: string, result: "studied" | "correct" | "wrong", correctCount: number, wrongCount: number) {
  if (result === "wrong") return shiftDate(today, 1);
  if (result === "studied") return shiftDate(today, 1 + Math.floor(Math.random() * 3));
  if (wrongCount > 0) return shiftDate(today, 1 + Math.floor(Math.random() * 2));
  if (correctCount < 2) return shiftDate(today, 1 + Math.floor(Math.random() * 3));
  return shiftDate(today, 2 + Math.floor(Math.random() * 2));
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadWordProgress() {
  try {
    const rawValue = window.localStorage.getItem(learnedWordsStorageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    if (parsed.every((value) => typeof value === "string")) {
      return parsed.map((en) => ({
        en,
        seenCount: 1,
        correctCount: 1,
        wrongCount: 0,
        lastSeenAt: shiftDate(getLocalDateKey(), -1),
        nextReviewAt: shiftDate(getLocalDateKey(), 1),
        lastResult: "correct" as const
      }));
    }
    return parsed.filter(isWordProgressRecord);
  } catch {
    return [];
  }
}

function saveWordProgress(words: WordProgressRecord[]) {
  try {
    window.localStorage.setItem(learnedWordsStorageKey, JSON.stringify(words));
  } catch {
    // Local word progress should never block the study flow.
  }
}

function isWordProgressRecord(value: unknown): value is WordProgressRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<WordProgressRecord>;
  return (
    typeof record.en === "string" &&
    typeof record.seenCount === "number" &&
    typeof record.correctCount === "number" &&
    typeof record.wrongCount === "number" &&
    typeof record.nextReviewAt === "string" &&
    (record.lastResult === "studied" || record.lastResult === "correct" || record.lastResult === "wrong")
  );
}

function loadAppSettings(): { language: AppLanguage; fontMode: FontMode } {
  try {
    const rawValue = window.localStorage.getItem(appSettingsStorageKey);
    if (!rawValue) return { language: "ko", fontMode: "default" };
    const parsed = JSON.parse(rawValue) as Partial<{ language: AppLanguage; fontMode: FontMode }>;
    return {
      language: parsed.language === "en" ? "en" : "ko",
      fontMode: parsed.fontMode === "system" ? "system" : "default"
    };
  } catch {
    return { language: "ko", fontMode: "default" };
  }
}

function saveAppSettings(settings: { language: AppLanguage; fontMode: FontMode }) {
  try {
    window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(settings));
  } catch {
    // Settings persistence should never block app usage.
  }
}

function backupAppData(tasks: Task[]) {
  const payload = {
    app: "잊지 마",
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    localStorage: {
      settings: readLocalStorageJson(appSettingsStorageKey),
      wordProgress: readLocalStorageJson(learnedWordsStorageKey),
      memos: readLocalStorageJson(memoStorageKey),
      planBlocks: readLocalStorageJson(planBlocksStorageKey)
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dont-forget-backup-${getLocalDateKey()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readLocalStorageJson(key: string) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function loadStoredMemos() {
  try {
    const rawValue = window.localStorage.getItem(memoStorageKey);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMemo);
  } catch {
    return [];
  }
}

function saveStoredMemos(memos: Memo[]) {
  try {
    window.localStorage.setItem(memoStorageKey, JSON.stringify(memos));
  } catch {
    // Memo persistence should never block the app shell.
  }
}

function loadStoredPlanBlocks() {
  try {
    const rawValue = window.localStorage.getItem(planBlocksStorageKey);
    if (rawValue) {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) return parsed.filter(isPlanBlock);
    }
  } catch {
    // Fall through to default plan blocks.
  }

  return [
    { id: "plan-default-01", title: "아침식사", startTime: "07:30", endTime: "08:00", kind: "life", taskId: null },
    { id: "plan-default-02", title: "씻기 / 준비", startTime: "08:00", endTime: "08:30", kind: "life", taskId: null },
    { id: "plan-default-03", title: "점심", startTime: "12:30", endTime: "13:00", kind: "life", taskId: null },
    { id: "plan-default-04", title: "저녁식사", startTime: "18:30", endTime: "19:00", kind: "life", taskId: null },
    { id: "plan-default-05", title: "정리하고 자기", startTime: "23:30", endTime: "23:59", kind: "life", taskId: null }
  ] satisfies PlanBlock[];
}

function saveStoredPlanBlocks(blocks: PlanBlock[]) {
  try {
    window.localStorage.setItem(planBlocksStorageKey, JSON.stringify(blocks));
  } catch {
    // Plan persistence should never block the app shell.
  }
}

function isPlanBlock(value: unknown): value is PlanBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<PlanBlock>;
  return (
    typeof block.id === "string" &&
    typeof block.title === "string" &&
    typeof block.startTime === "string" &&
    typeof block.endTime === "string" &&
    (block.kind === "life" || block.kind === "task")
  );
}

function isMemo(value: unknown): value is Memo {
  if (!value || typeof value !== "object") return false;
  const memo = value as Partial<Memo>;
  return typeof memo.id === "string" && typeof memo.content === "string" && typeof memo.createdAt === "string";
}

function formatMemoTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function upsertStudiedResult(
  results: Array<{ en: string; result: "studied" | "correct" | "wrong" }>,
  en: string,
  result: "studied" | "correct" | "wrong"
) {
  const existingIndex = results.findIndex((item) => item.en === en);
  if (existingIndex < 0) return [...results, { en, result }];
  return results.map((item, index) => (index === existingIndex ? { en, result } : item));
}
