import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { sortTodayTasks } from "./todayRules";
import styles from "./TodayView.module.css";
import { loadStoredSchedules, saveStoredSchedules } from "../../services/scheduleStorage";
import { loadStoredTasks, saveStoredTasks } from "../../services/taskStorage";
import { getLocalRecovery, restoreLocalRecovery, saveLocalRecovery } from "../../services/dataRecovery";
import {
  connectGoogleDrive,
  createDriveBackup,
  disconnectGoogleDrive,
  getDriveRecoveryCreatedAt,
  getLastDriveSync,
  isGoogleDriveConfigured,
  isGoogleDriveConnected,
  resolveDriveConflict,
  restoreDriveRecoveryBackup,
  syncToGoogleDrive
} from "../../services/googleDriveSync";
import type { RepeatKind, Schedule, Task, TaskKindOption, TaskOwner, TaskSource, TaskStatus, TodaySortGroup } from "../../types/task";

type AppTab = "plan" | "tasks" | "calendar" | "words" | "pomodoro" | "memo" | "settings";

type AppLanguage = "ko" | "en";

type FontMode = "default" | "system";

type ReminderPermission = NotificationPermission | "unsupported";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallState = "available" | "installed" | "unavailable";

type InstallReadiness = {
  secureContext: boolean;
  manifest: boolean;
  icons: boolean;
  serviceWorker: boolean;
};

type DailyNote = {
  date: string;
  text: string;
  updatedAt: string;
};

type AppBackupPayload = {
  app: "잊지 마";
  version: 1;
  exportedAt: string;
  tasks: Task[];
  schedules: Schedule[];
  localStorage?: {
    settings?: unknown;
    wordProgress?: unknown;
    memos?: unknown;
    planBlocks?: unknown;
    timerSettings?: unknown;
    dailyFocus?: unknown;
    dailyNotes?: unknown;
  };
};

const WordsTab = lazy(() => import("./WordsTab"));
const PomodoroTab = lazy(() => import("./PomodoroTab"));
const MemoTab = lazy(() => import("./MemoTab"));

type AppSettings = {
  language: AppLanguage;
  fontMode: FontMode;
};

type PlanBlock = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  kind: "life" | "task";
  taskId: string | null;
};

const tabLabels: Record<AppLanguage, Record<AppTab, string>> = {
  ko: {
    plan: "계획표",
    tasks: "할일",
    calendar: "달력",
    words: "단어 학습",
    pomodoro: "타이머",
    memo: "메모",
    settings: "설정"
  },
  en: {
    plan: "Planner",
    tasks: "Tasks",
    calendar: "Calendar",
    words: "Word Study",
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

const viewParamToTab: Record<string, AppTab> = {
  plan: "plan",
  tasks: "tasks",
  today: "tasks",
  calendar: "calendar",
  words: "words",
  vocabulary: "words",
  pomodoro: "pomodoro",
  timer: "pomodoro",
  memo: "memo",
  records: "calendar",
  stats: "calendar",
  settings: "settings"
};

const kindOptions: Array<{ id: TaskKindOption; label: Record<AppLanguage, string>; description: Record<AppLanguage, string> }> = [
  { id: "no_deadline", label: { ko: "기한 없음", en: "No Deadline" }, description: { ko: "날짜 없이 보관", en: "Keep without a date" } },
  { id: "today", label: { ko: "오늘", en: "Today" }, description: { ko: "오늘 할 일", en: "Add to today" } },
  { id: "dday", label: { ko: "D-day", en: "D-day" }, description: { ko: "마감일 계산", en: "Track due date" } },
  { id: "repeat", label: { ko: "반복설정", en: "Repeat" }, description: { ko: "기간/요일/매월", en: "Period, weekday, monthly" } }
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

const learnedWordsStorageKey = "dont-forget-learned-words";
const memoStorageKey = "dont-forget-memos";
const planBlocksStorageKey = "dont-forget-plan-blocks";
const appSettingsStorageKey = "dont-forget-app-settings";
const timerSettingsStorageKey = "dont-forget-timer-settings";
const dailyFocusStorageKey = "dont-forget-daily-focus";
const dailyNotesStorageKey = "dont-forget-daily-notes";

export function TodayView() {
  const [activeTab, setActiveTab] = useState<AppTab>(() => getInitialAppTab());
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => loadAppSettings().language);
  const [fontMode, setFontMode] = useState<FontMode>(() => loadAppSettings().fontMode);
  const [notificationPermission, setNotificationPermission] = useState<ReminderPermission>(() => getNotificationPermission());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [dataResetToken, setDataResetToken] = useState(0);
  const [hasOpenedWords, setHasOpenedWords] = useState(false);
  const [hasOpenedPomodoro, setHasOpenedPomodoro] = useState(false);
  const [hasOpenedMemo, setHasOpenedMemo] = useState(false);
  const initialTasks = useMemo(() => loadStoredTasks(), []);
  const [tasks, setTasks] = useState<Task[]>(() => initialTasks.filter((task) => !isSchedulerOwnedTask(task)));
  const [schedules, setSchedules] = useState<Schedule[]>(() =>
    mergeSchedules(loadStoredSchedules(), migrateScheduleTasks(initialTasks))
  );
  const [dailyNotes, setDailyNotes] = useState<DailyNote[]>(() => loadStoredDailyNotes());
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateKey());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [activeCreatePanel, setActiveCreatePanel] = useState<"task" | "schedule" | null>(null);
  const [isDriveConnected, setIsDriveConnected] = useState(() => isGoogleDriveConnected());
  const [driveRecoveryCreatedAt, setDriveRecoveryCreatedAt] = useState(() => getDriveRecoveryCreatedAt());
  const [localRecoveryCreatedAt, setLocalRecoveryCreatedAt] = useState(() => getLocalRecovery()?.createdAt ?? null);
  const [driveConflictAt, setDriveConflictAt] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<InstallState>(() => getInitialInstallState());
  const [installReadiness, setInstallReadiness] = useState<InstallReadiness | null>(null);
  const [authMessage, setAuthMessage] = useState(
    isGoogleDriveConfigured()
      ? getLastDriveSync()
        ? `마지막 Drive 동기화 · ${formatSyncTime(getLastDriveSync()!)}`
        : "Google Drive 연결 준비됨"
      : "Google Drive 설정 필요"
  );
  const lastUploadedSnapshot = useRef("");
  const firedReminderKeys = useRef(new Set<string>());

  const todayTasks = useMemo(
    () => sortTodayTasks([...getTasksForDate(tasks, selectedDate), ...getScheduleTasksForDate(schedules, selectedDate)]),
    [tasks, schedules, selectedDate]
  );
  const activeReminderTasks = useMemo(
    () => getDueReminderTasks(todayTasks, selectedDate, nowTick),
    [todayTasks, selectedDate, nowTick]
  );
  const editingTask = tasks.find((task) => task.id === editingTaskId) ?? null;
  const fixedTaskTags = useMemo(() => getFixedTaskTags(tasks), [tasks]);

  useEffect(() => {
    document.documentElement.dataset.fontMode = fontMode;
    document.documentElement.lang = appLanguage === "ko" ? "ko" : "en";
    saveAppSettings({ language: appLanguage, fontMode });
  }, [appLanguage, fontMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallState("available");
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setInstallState("installed");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    checkInstallReadiness().then((readiness) => {
      if (!cancelled) setInstallReadiness(readiness);
    });

    return () => {
      cancelled = true;
    };
  }, [installState]);

  useEffect(() => {
    if (activeTab === "words") setHasOpenedWords(true);
    if (activeTab === "pomodoro") setHasOpenedPomodoro(true);
    if (activeTab === "memo") setHasOpenedMemo(true);
  }, [activeTab]);

  useEffect(() => {
    const view = getTabViewParam(activeTab);
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") === view) return;
    url.searchParams.set("view", view);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }, [activeTab]);

  useEffect(() => {
    saveStoredTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    saveStoredSchedules(schedules);
  }, [schedules]);

  useEffect(() => {
    saveStoredDailyNotes(dailyNotes);
  }, [dailyNotes]);

  useEffect(() => {
    if (!isDriveConnected) return;

    const sync = async () => {
      const snapshot = JSON.stringify(createDriveBackup().data);
      if (snapshot === lastUploadedSnapshot.current) return;

      try {
        const updatedAt = await syncToGoogleDrive();
        lastUploadedSnapshot.current = snapshot;
        setAuthMessage(`Google Drive 동기화 완료 · ${formatSyncTime(updatedAt)}`);
      } catch {
        setIsDriveConnected(false);
        setAuthMessage("Drive 연결이 만료되었습니다. 다시 연결해 주세요.");
      }
    };

    const timer = window.setInterval(() => void sync(), 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") void sync();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isDriveConnected]);

  useEffect(() => {
    if (notificationPermission !== "granted") return;

    const timers = scheduleBrowserReminders(todayTasks, selectedDate, firedReminderKeys.current);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [todayTasks, selectedDate, notificationPermission]);

  function updateTask(nextTask: Task) {
    setTasks((current) => current.map((task) => (task.id === nextTask.id ? nextTask : task)));
  }

  function toggleTaskDone(task: Task, date: string) {
    const actionAt = new Date().toISOString();
    if (task.owner === "schedule" && task.scheduleId) {
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === task.scheduleId
            ? {
                ...schedule,
                status: schedule.status === "done" ? "planned" : "done",
                updatedAt: new Date().toISOString()
              }
            : schedule
        )
      );
      setEditingTaskId(null);
      return;
    }

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
        remainingPercent: 100,
        completedAt: null
      });
      return;
    }

    updateTask({
      ...task,
      status: "done",
      progressPercent: 100,
      remainingPercent: 0,
      completedAt: actionAt,
      postponedAt: null,
      cancelledAt: null
    });
    setEditingTaskId(null);
  }

  function saveTask(nextTask: Task) {
    if (isSchedulerOwnedTask(nextTask)) {
      setTasks((current) => current.filter((task) => task.id !== nextTask.id));
      setSchedules((current) => mergeSchedules(current, migrateScheduleTasks([nextTask])));
      setEditingTaskId(null);
      return;
    }

    updateTask(nextTask);
    setEditingTaskId(null);
  }

  function deleteTask(taskId: string) {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setEditingTaskId(null);
  }

  function postponeReminder(task: Task) {
    const nextReminderAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (task.owner === "schedule" && task.scheduleId) {
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === task.scheduleId
            ? {
                ...schedule,
                reminderAt: nextReminderAt,
                updatedAt: new Date().toISOString()
              }
            : schedule
        )
      );
      setNowTick(Date.now());
      return;
    }

    updateTask({
      ...task,
      status: "postponed",
      postponeCount: task.postponeCount + 1,
      reminderAt: nextReminderAt,
      postponedAt: new Date().toISOString()
    });
    setNowTick(Date.now());
  }

  function cancelReminder(task: Task) {
    if (task.owner === "schedule" && task.scheduleId) {
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === task.scheduleId
            ? {
                ...schedule,
                status: "cancelled",
                updatedAt: new Date().toISOString()
              }
            : schedule
        )
      );
      return;
    }

    updateTask({
      ...task,
      status: "cancelled",
      reminderAt: null,
      cancelledAt: new Date().toISOString()
    });
  }

  function addTask(task: Task) {
    if (isSchedulerOwnedTask(task)) {
      setSchedules((current) => mergeSchedules(current, migrateScheduleTasks([task])));
      setActiveCreatePanel(null);
      return;
    }

    setTasks((current) => [task, ...current]);
    setActiveCreatePanel(null);
  }

  function addSchedule(schedule: Schedule) {
    setSchedules((current) => [schedule, ...current]);
  }

  function saveSchedule(nextSchedule: Schedule) {
    setSchedules((current) => mergeSchedules(current.map((schedule) => (schedule.id === nextSchedule.id ? nextSchedule : schedule))));
  }

  function deleteSchedule(scheduleId: string) {
    setSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
  }

  function saveDailyNote(date: string, text: string) {
    setDailyNotes((current) => {
      if (!text.trim()) return current.filter((note) => note.date !== date);
      const nextNote: DailyNote = { date, text, updatedAt: new Date().toISOString() };
      const exists = current.some((note) => note.date === date);
      return exists ? current.map((note) => (note.date === date ? nextNote : note)) : [...current, nextNote];
    });
  }

  async function handleGoogleDrive() {
    if (!isGoogleDriveConfigured()) {
      setAuthMessage(".env에 Google OAuth 클라이언트 ID를 넣어 주세요.");
      return;
    }

    try {
      if (isDriveConnected) {
        await disconnectGoogleDrive();
        setIsDriveConnected(false);
        setAuthMessage("Google Drive 연결 준비됨");
        return;
      }

      setAuthMessage("Google Drive 연결 중");
      const result = await connectGoogleDrive();
      setDriveRecoveryCreatedAt(getDriveRecoveryCreatedAt());

      if (result.status === "conflict") {
        setDriveConflictAt(result.updatedAt);
        setIsDriveConnected(false);
        setAuthMessage("Drive 데이터와 현재 데이터가 다릅니다. 사용할 데이터를 선택해 주세요.");
        return;
      }

      setDriveConflictAt(null);
      setIsDriveConnected(true);
      lastUploadedSnapshot.current = JSON.stringify(createDriveBackup().data);
      setAuthMessage(`Google Drive 동기화 완료 · ${formatSyncTime(result.updatedAt)}`);
    } catch {
      setAuthMessage("Google Drive 연결을 완료하지 못했습니다.");
    }
  }

  async function handleDriveSync() {
    if (!isDriveConnected) return;

    try {
      setAuthMessage("Google Drive 동기화 중");
      const updatedAt = await syncToGoogleDrive();
      lastUploadedSnapshot.current = JSON.stringify(createDriveBackup().data);
      setAuthMessage(`Google Drive 동기화 완료 · ${formatSyncTime(updatedAt)}`);
    } catch {
      setIsDriveConnected(false);
      setAuthMessage("Drive 연결이 만료되었습니다. 다시 연결해 주세요.");
    }
  }

  async function handleDriveConflict(choice: "remote" | "local") {
    try {
      setAuthMessage(choice === "remote" ? "Drive 데이터를 불러오는 중" : "현재 데이터를 Drive에 저장하는 중");
      const updatedAt = await resolveDriveConflict(choice);
      setDriveConflictAt(null);
      setIsDriveConnected(true);

      if (choice === "remote") {
        setAuthMessage("Drive 데이터를 불러왔습니다. 앱을 새로 여는 중입니다.");
        window.location.reload();
        return;
      }

      lastUploadedSnapshot.current = JSON.stringify(createDriveBackup().data);
      setAuthMessage(`Google Drive 동기화 완료 · ${formatSyncTime(updatedAt)}`);
    } catch {
      setIsDriveConnected(false);
      setAuthMessage("Drive 충돌을 해결하지 못했습니다. 다시 연결해 주세요.");
    }
  }

  function handleDriveRecovery() {
    if (!driveRecoveryCreatedAt) return;
    const confirmed = window.confirm(
      appLanguage === "ko"
        ? `${formatBackupDate(driveRecoveryCreatedAt)}의 Drive 연결 전 데이터로 되돌릴까요?\n현재 로컬 데이터는 교체됩니다.`
        : `Restore the local data saved before Drive connection on ${formatBackupDate(driveRecoveryCreatedAt)}?\nCurrent local data will be replaced.`
    );
    if (!confirmed) return;

    if (!restoreDriveRecoveryBackup()) {
      setDriveRecoveryCreatedAt(null);
      setAuthMessage(appLanguage === "ko" ? "복구할 Drive 이전 데이터가 없습니다." : "No pre-Drive recovery data is available.");
      return;
    }

    window.location.reload();
  }

  function handleLocalRecovery() {
    if (!localRecoveryCreatedAt) return;
    const confirmed = window.confirm(
      appLanguage === "ko"
        ? `${formatBackupDate(localRecoveryCreatedAt)}의 자동 복구본으로 되돌릴까요?\n현재 데이터는 복구본으로 교체됩니다.`
        : `Restore the automatic recovery point from ${formatBackupDate(localRecoveryCreatedAt)}?\nCurrent data will be replaced.`
    );
    if (!confirmed) return;

    if (!restoreLocalRecovery()) {
      setLocalRecoveryCreatedAt(null);
      return;
    }
    window.location.reload();
  }

  async function handleNotificationRequest() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    const nextPermission = await Notification.requestPermission();
    setNotificationPermission(nextPermission);
  }

  async function handleInstallApp() {
    if (!installPrompt) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallState(choice.outcome === "accepted" ? "installed" : "unavailable");
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>{appLanguage === "ko" ? "습관 기르기" : "Habit guide"}</p>
          <h1>{appLanguage === "ko" ? "잊지 마" : "Don't Forget"}</h1>
        </div>
      </header>

      <nav className={styles.tabs} aria-label={appLanguage === "ko" ? "주요 화면" : "Main screens"}>
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

      <PlanTab
          tasks={todayTasks}
          selectedDate={selectedDate}
          language={appLanguage}
          isActive={activeTab === "plan"}
      />

      {activeTab === "tasks" && (
        <TasksTab
          todayTasks={todayTasks}
          editingTask={editingTask}
          activeCreatePanel={activeCreatePanel}
          activeReminderTasks={activeReminderTasks}
          fixedTaskTags={fixedTaskTags}
          language={appLanguage}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onToggleCreatePanel={(panel) => setActiveCreatePanel((current) => (current === panel ? null : panel))}
          onAddTask={addTask}
          onAddSchedule={addSchedule}
          schedules={schedules}
          onEdit={setEditingTaskId}
          onCloseEdit={() => setEditingTaskId(null)}
          onToggleDone={toggleTaskDone}
          onPostponeReminder={postponeReminder}
          onCancelReminder={cancelReminder}
          onSaveTask={saveTask}
          onDeleteTask={deleteTask}
          onSaveSchedule={saveSchedule}
          onDeleteSchedule={deleteSchedule}
        />
      )}

      {activeTab === "calendar" && (
        <CalendarTab
          tasks={tasks}
          schedules={schedules}
          dailyNotes={dailyNotes}
          selectedDate={selectedDate}
          language={appLanguage}
          onDateChange={setSelectedDate}
          onToggleDone={toggleTaskDone}
          onSaveDailyNote={saveDailyNote}
          onOpenTasks={() => setActiveTab("tasks")}
        />
      )}
      {hasOpenedWords && (
        <Suspense
          fallback={
            activeTab === "words" ? (
              <section className={styles.mainPanel}>
                <div className={styles.vocabDone}>
                  <strong>{appLanguage === "ko" ? "단어장 불러오는 중" : "Loading Word Study"}</strong>
                </div>
              </section>
            ) : null
          }
        >
          <WordsTab
            isActive={activeTab === "words"}
            language={appLanguage}
            dataResetToken={dataResetToken}
          />
        </Suspense>
      )}
      {hasOpenedPomodoro && (
        <Suspense fallback={activeTab === "pomodoro" ? <LazyTabFallback language={appLanguage} /> : null}>
          <PomodoroTab tasks={todayTasks} selectedDate={selectedDate} isActive={activeTab === "pomodoro"} language={appLanguage} />
        </Suspense>
      )}
      {hasOpenedMemo && (
        <Suspense fallback={activeTab === "memo" ? <LazyTabFallback language={appLanguage} /> : null}>
          <MemoTab isActive={activeTab === "memo"} language={appLanguage} />
        </Suspense>
      )}
      {activeTab === "settings" && (
        <SettingsTab
          language={appLanguage}
          fontMode={fontMode}
          isDriveConnected={isDriveConnected}
          driveRecoveryCreatedAt={driveRecoveryCreatedAt}
          localRecoveryCreatedAt={localRecoveryCreatedAt}
          driveConflictAt={driveConflictAt}
          authMessage={authMessage}
          onLanguageChange={setAppLanguage}
          onFontModeChange={setFontMode}
          notificationPermission={notificationPermission}
          onNotificationRequest={handleNotificationRequest}
          onBackup={() => backupAppData(tasks, schedules)}
          onRestore={(file) =>
            void restoreAppData(file, appLanguage, (createdAt) => setLocalRecoveryCreatedAt(createdAt))
          }
          onDeleteData={() =>
            void deleteAppData(appLanguage, (createdAt) => {
              setLocalRecoveryCreatedAt(createdAt);
              setTasks([]);
              setSchedules([]);
              setDataResetToken((current) => current + 1);
            })
          }
          onGoogleDrive={handleGoogleDrive}
          onDriveSync={handleDriveSync}
          onDriveRecovery={handleDriveRecovery}
          onLocalRecovery={handleLocalRecovery}
          onDriveConflict={handleDriveConflict}
          installState={installState}
          installReadiness={installReadiness}
          onInstallApp={handleInstallApp}
        />
      )}
    </main>
  );
}

function LazyTabFallback({ language }: { language: AppLanguage }) {
  return (
    <section className={styles.mainPanel}>
      <div className={styles.vocabDone}>
        <strong>{language === "ko" ? "불러오는 중" : "Loading"}</strong>
      </div>
    </section>
  );
}

type TasksTabProps = {
  todayTasks: Task[];
  editingTask: Task | null;
  activeCreatePanel: "task" | "schedule" | null;
  activeReminderTasks: Task[];
  fixedTaskTags: string[];
  language: AppLanguage;
  schedules: Schedule[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  onToggleCreatePanel: (panel: "task" | "schedule") => void;
  onAddTask: (task: Task) => void;
  onAddSchedule: (schedule: Schedule) => void;
  onEdit: (taskId: string) => void;
  onCloseEdit: () => void;
  onToggleDone: (task: Task, date: string) => void;
  onPostponeReminder: (task: Task) => void;
  onCancelReminder: (task: Task) => void;
  onSaveTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onSaveSchedule: (schedule: Schedule) => void;
  onDeleteSchedule: (scheduleId: string) => void;
};

function RecordItem({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.recordItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function SettingsTab({
  language,
  fontMode,
  isDriveConnected,
  driveRecoveryCreatedAt,
  localRecoveryCreatedAt,
  driveConflictAt,
  authMessage,
  onLanguageChange,
  onFontModeChange,
  notificationPermission,
  onNotificationRequest,
  onBackup,
  onRestore,
  onDeleteData,
  onGoogleDrive,
  onDriveSync,
  onDriveRecovery,
  onLocalRecovery,
  onDriveConflict,
  installState,
  installReadiness,
  onInstallApp
}: {
  language: AppLanguage;
  fontMode: FontMode;
  isDriveConnected: boolean;
  driveRecoveryCreatedAt: string | null;
  localRecoveryCreatedAt: string | null;
  driveConflictAt: string | null;
  authMessage: string;
  onLanguageChange: (language: AppLanguage) => void;
  onFontModeChange: (fontMode: FontMode) => void;
  notificationPermission: ReminderPermission;
  onNotificationRequest: () => void;
  onBackup: () => void;
  onRestore: (file: File) => void;
  onDeleteData: () => void;
  onGoogleDrive: () => void;
  onDriveSync: () => void;
  onDriveRecovery: () => void;
  onLocalRecovery: () => void;
  onDriveConflict: (choice: "remote" | "local") => void;
  installState: InstallState;
  installReadiness: InstallReadiness | null;
  onInstallApp: () => void;
}) {
  return (
    <section className={styles.mainPanel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{language === "ko" ? "설정" : "Settings"}</h2>
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
          <div className={styles.settingsActionGroup}>
            <button type="button" className={styles.settingsAction} onClick={onBackup}>
              {language === "ko" ? "데이터 백업하기" : "Back Up Data"}
            </button>
            <label className={styles.settingsAction}>
              {language === "ko" ? "백업 복원하기" : "Restore Backup"}
              <input
                className={styles.settingsFileInput}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onRestore(file);
                  event.target.value = "";
                }}
              />
            </label>
            <button type="button" className={`${styles.settingsAction} ${styles.dangerAction}`} onClick={onDeleteData}>
              {language === "ko" ? "데이터 삭제하기" : "Delete Data"}
            </button>
            {localRecoveryCreatedAt && (
              <button type="button" className={styles.settingsAction} onClick={onLocalRecovery}>
                {language === "ko"
                  ? `자동 복구 · ${formatBackupDate(localRecoveryCreatedAt)}`
                  : `Automatic Recovery · ${formatBackupDate(localRecoveryCreatedAt)}`}
              </button>
            )}
          </div>
        </section>

        <section className={styles.settingsGroup}>
          <div>
            <h3>{language === "ko" ? "알림" : "Notifications"}</h3>
            <p>
              {language === "ko"
                ? getNotificationStatusLabel(notificationPermission)
                : getNotificationStatusLabelEn(notificationPermission)}
            </p>
          </div>
          <button
            type="button"
            className={styles.settingsAction}
            onClick={onNotificationRequest}
            disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
          >
            {language === "ko" ? "브라우저 알림 켜기" : "Enable Browser Notifications"}
          </button>
        </section>

        <section className={styles.settingsGroup}>
          <div>
            <h3>{language === "ko" ? "앱 설치" : "Install App"}</h3>
            <p>{getInstallStatusLabel(installState, language)}</p>
            <InstallReadinessList readiness={installReadiness} installState={installState} language={language} />
            <span className={styles.syncScope}>{getInstallHintLabel(installState, language)}</span>
          </div>
          <button
            type="button"
            className={styles.settingsAction}
            onClick={onInstallApp}
            disabled={installState !== "available"}
          >
            {getInstallActionLabel(installState, language)}
          </button>
        </section>

        <section className={styles.settingsGroup}>
          <div>
            <h3>Google Drive</h3>
            <p>{getAuthMessageLabel(authMessage, language)}</p>
            <span className={styles.syncScope}>
              {language === "ko"
                ? "앱 전용 숨김 폴더에 저장되며 각 사용자의 Google Drive 용량을 사용합니다."
                : "Data is stored in a private app folder using each user's own Google Drive storage."}
            </span>
            {driveRecoveryCreatedAt && (
              <span className={styles.syncScope}>
                {language === "ko"
                  ? `Drive 연결 전 복구본 · ${formatBackupDate(driveRecoveryCreatedAt)}`
                  : `Pre-Drive recovery · ${formatBackupDate(driveRecoveryCreatedAt)}`}
              </span>
            )}
            {driveConflictAt && (
              <span className={styles.driveConflictNotice}>
                {language === "ko"
                  ? `Drive 백업 ${formatBackupDate(driveConflictAt)} · 어느 데이터를 유지할지 선택하세요.`
                  : `Drive backup ${formatBackupDate(driveConflictAt)} · Choose which data to keep.`}
              </span>
            )}
          </div>
          <div className={styles.settingsActionGroup}>
            {driveConflictAt && (
              <>
                <button type="button" className={styles.settingsAction} onClick={() => onDriveConflict("remote")}>
                  {language === "ko" ? "Drive 데이터 사용" : "Use Drive Data"}
                </button>
                <button type="button" className={styles.settingsAction} onClick={() => onDriveConflict("local")}>
                  {language === "ko" ? "현재 데이터 유지" : "Keep Current Data"}
                </button>
              </>
            )}
            {driveRecoveryCreatedAt && (
              <button type="button" className={styles.settingsAction} onClick={onDriveRecovery}>
                {language === "ko" ? "연결 전 데이터로 복구" : "Restore Pre-Drive Data"}
              </button>
            )}
            {isDriveConnected && (
              <button type="button" className={styles.settingsAction} onClick={onDriveSync}>
                {language === "ko" ? "지금 동기화" : "Sync Now"}
              </button>
            )}
            <button type="button" className={styles.settingsAction} onClick={onGoogleDrive} disabled={Boolean(driveConflictAt)}>
              {isDriveConnected
                ? language === "ko" ? "Drive 연결 해제" : "Disconnect Drive"
                : language === "ko" ? "내 Google Drive 연결" : "Connect My Google Drive"}
            </button>
          </div>
        </section>

        <section className={`${styles.settingsGroup} ${styles.helpGroup}`}>
          <div>
            <h3>{language === "ko" ? "도움말" : "Help"}</h3>
            {language === "ko" ? (
              <ul>
                <li>잊지 마는 생활 루틴, 할일, 일정, 단어 학습과 타이머를 한 흐름에서 관리하는 실행 관리 앱입니다.</li>
                <li>설정: 앱 표시 방식, 계정, 백업, 데이터 삭제를 관리합니다.</li>
                <li>계획표: 생활 루틴과 시간 있는 할일을 한 시간표에서 봅니다.</li>
                <li>할일: 오늘 처리할 일을 관리하고, 일정은 읽기용으로 함께 확인합니다.</li>
                <li>일정 등록: 날짜 일정, 기간 일정, D-day를 별도 일정 데이터로 저장합니다.</li>
                <li>달력: 반복은 실제 완료한 날만 색칠하고, 일반 일정은 날짜 칸에 텍스트로 표시합니다.</li>
                <li>단어 학습: 먼저 익히고, 퀴즈로 확인하며, 복습 단어가 다시 섞입니다.</li>
                <li>타이머: 집중과 휴식을 그때그때 설정해서 사용합니다.</li>
              </ul>
            ) : (
              <ul>
                <li>Don&apos;t Forget manages routines, tasks, schedules, vocabulary, and timers in one flow.</li>
                <li>Settings: Manage display, account, backup, and data deletion.</li>
                <li>Planner: View routines and timed tasks in one schedule.</li>
                <li>Tasks: Manage today&apos;s tasks and review schedule entries as read-only items.</li>
                <li>Schedule entry: Date events, period events, and D-days are stored separately from tasks.</li>
                <li>Calendar: Repeating items are colored only on completed days, while ordinary events appear as text in date cells.</li>
                <li>Word Study: Study first, quiz after, and review words return later.</li>
                <li>Timer: Set focus and break sessions as needed.</li>
              </ul>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PlanTab({
  tasks,
  selectedDate,
  language,
  isActive
}: {
  tasks: Task[];
  selectedDate: string;
  language: AppLanguage;
  isActive: boolean;
}) {
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
    <section className={styles.mainPanel} hidden={!isActive}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{formatDateHeading(selectedDate, language)} {language === "ko" ? "계획표" : "Planner"}</h2>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.headerMeta}>{language === "ko" ? `${timelineItems.length}개` : `${timelineItems.length} items`}</span>
          <button
            type="button"
            className={isAddingRoutine ? `${styles.addInlineButton} ${styles.activeInlineButton}` : styles.addInlineButton}
            onClick={() => setIsAddingRoutine((current) => !current)}
          >
            {isAddingRoutine ? (language === "ko" ? "추가 닫기" : "Close") : language === "ko" ? "루틴 추가" : "Add Routine"}
          </button>
        </div>
      </div>

      {isAddingRoutine && (
        <form className={styles.planComposer} onSubmit={addPlanBlock}>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>{language === "ko" ? "시작" : "Start"}</span>
              <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>{language === "ko" ? "종료" : "End"}</span>
              <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
            </label>
          </div>
          <label className={styles.formRow}>
            <span>{language === "ko" ? "루틴 제목" : "Routine Title"}</span>
            <input
              value={title}
              placeholder={language === "ko" ? "예: 아침식사" : "e.g. Breakfast"}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button type="submit" className={styles.completeButton}>{language === "ko" ? "저장" : "Save"}</button>
        </form>
      )}

      <div className={styles.planTimeline}>
        {timelineItems.length > 0 ? (
          timelineItems.map((item) => (
            <article
              key={item.id}
              className={item.kind === "task" ? `${styles.planBlock} ${styles.taskPlanBlock}` : styles.planBlock}
            >
              <time>{item.endTime ? `${item.startTime} ~ ${item.endTime}` : item.startTime}</time>
              <div>
                <strong>{item.title}</strong>
                <span>{item.kind === "task" ? (language === "ko" ? "할일" : "Task") : language === "ko" ? "생활 루틴" : "Life Routine"}</span>
              </div>
              {item.canDelete ? (
                <button type="button" onClick={() => deletePlanBlock(item.id)}>{language === "ko" ? "삭제" : "Delete"}</button>
              ) : (
                <span className={styles.planReadOnly}>{language === "ko" ? "자동" : "Auto"}</span>
              )}
            </article>
          ))
        ) : (
          <p className={styles.emptyState}>{language === "ko" ? "루틴을 추가하면 시간 순서로 표시됩니다." : "Add a routine to build your timeline."}</p>
        )}
      </div>

      <section className={styles.untimedTaskPanel}>
        <h3>{language === "ko" ? "시간 없는 할일" : "Untimed Tasks"}</h3>
        {untimedTasks.length > 0 ? (
          <div className={styles.untimedTaskList}>
            {untimedTasks.map((task) => (
              <article key={task.id} className={styles.untimedTaskItem}>
                <strong>{task.title}</strong>
                <span>{getTaskSourceLabel(task, language)}</span>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.emptyState}>{language === "ko" ? "시간 없이 남아 있는 할일이 없습니다." : "No untimed tasks left."}</p>
        )}
      </section>
    </section>
  );
}

function InstallReadinessList({
  readiness,
  installState,
  language
}: {
  readiness: InstallReadiness | null;
  installState: InstallState;
  language: AppLanguage;
}) {
  const items = [
    {
      key: "secure",
      ok: readiness?.secureContext ?? false,
      label: language === "ko" ? "보안 연결" : "Secure context"
    },
    {
      key: "manifest",
      ok: readiness?.manifest ?? false,
      label: language === "ko" ? "앱 정보" : "Manifest"
    },
    {
      key: "icons",
      ok: readiness?.icons ?? false,
      label: language === "ko" ? "설치 아이콘" : "Install icons"
    },
    {
      key: "serviceWorker",
      ok: readiness?.serviceWorker ?? false,
      label: language === "ko" ? "오프라인 준비" : "Service worker"
    },
    {
      key: "prompt",
      ok: installState === "available" || installState === "installed",
      label: language === "ko" ? "설치 버튼" : "Install prompt"
    }
  ];

  return (
    <div className={styles.installChecklist} aria-label={language === "ko" ? "앱 설치 준비 상태" : "Install readiness"}>
      {items.map((item) => (
        <span key={item.key} className={item.ok ? styles.readyItem : styles.pendingItem}>
          <i>{item.ok ? "✓" : "·"}</i>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function TasksTab({
  todayTasks,
  editingTask,
  activeCreatePanel,
  activeReminderTasks,
  fixedTaskTags,
  language,
  schedules,
  selectedDate,
  onDateChange,
  onToggleCreatePanel,
  onAddTask,
  onAddSchedule,
  onEdit,
  onCloseEdit,
  onToggleDone,
  onPostponeReminder,
  onCancelReminder,
  onSaveTask,
  onDeleteTask,
  onSaveSchedule,
  onDeleteSchedule
}: TasksTabProps) {
  return (
    <section className={styles.tabContent}>
      <section className={styles.mainPanel} aria-label={language === "ko" ? "오늘 할 일" : "Today Tasks"}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.titleNav} aria-label={language === "ko" ? "날짜 이동" : "Date navigation"}>
              <button type="button" aria-label={language === "ko" ? "이전 날짜" : "Previous date"} onClick={() => onDateChange(shiftDate(selectedDate, -1))}>
                &lt;
              </button>
              <h2>{formatDateHeading(selectedDate, language)} {language === "ko" ? "할일" : "Tasks"}</h2>
              <button type="button" aria-label={language === "ko" ? "다음 날짜" : "Next date"} onClick={() => onDateChange(shiftDate(selectedDate, 1))}>
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
              {activeCreatePanel === "task" ? (language === "ko" ? "할일 닫기" : "Close Task") : language === "ko" ? "할일 등록" : "Add Task"}
            </button>
            <button
              className={activeCreatePanel === "schedule" ? `${styles.addInlineButton} ${styles.activeInlineButton}` : styles.addInlineButton}
              type="button"
              onClick={() => onToggleCreatePanel("schedule")}
            >
              {activeCreatePanel === "schedule" ? (language === "ko" ? "일정 닫기" : "Close Schedule") : language === "ko" ? "일정 등록" : "Add Schedule"}
            </button>
          </div>
        </div>

        <ReminderTray
          tasks={activeReminderTasks}
          selectedDate={selectedDate}
          language={language}
          onToggleDone={onToggleDone}
          onPostponeReminder={onPostponeReminder}
          onCancelReminder={onCancelReminder}
        />

        {activeCreatePanel === "task" && (
          <TaskCreateForm selectedDate={selectedDate} fixedTaskTags={fixedTaskTags} language={language} onAddTask={onAddTask} />
        )}
        {activeCreatePanel === "schedule" && (
          <SchedulePanel
            selectedDate={selectedDate}
            schedules={schedules}
            language={language}
            onAddSchedule={onAddSchedule}
            onSaveSchedule={onSaveSchedule}
            onDeleteSchedule={onDeleteSchedule}
          />
        )}

        <div className={styles.taskList}>
          {todayTasks.length > 0 ? (
            todayTasks.map((task) => (
              <div key={task.id} className={styles.taskStack}>
                <TaskRow
                  task={task}
                  selectedDate={selectedDate}
                  language={language}
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
                    language={language}
                    onSaveTask={onSaveTask}
                    onDeleteTask={onDeleteTask}
                  />
                )}
              </div>
            ))
          ) : (
            <p className={styles.emptyState}>{language === "ko" ? "등록된 할일이나 일정이 없습니다." : "No tasks or schedules for this day."}</p>
          )}
        </div>

        <RepeatProgressDots tasks={todayTasks} selectedDate={selectedDate} language={language} />
      </section>
    </section>
  );
}

function RepeatProgressDots({ tasks, selectedDate, language }: { tasks: Task[]; selectedDate: string; language: AppLanguage }) {
  const repeatTasks = tasks.filter(isRepeatTask);
  if (repeatTasks.length === 0) return null;

  return (
    <section className={styles.repeatProgress} aria-label={language === "ko" ? "반복 진행 기록" : "Repeat progress"}>
      <div className={styles.repeatProgressHeader}>
        <strong>{language === "ko" ? "반복 진행률" : "Repeat Progress"}</strong>
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
              <div className={styles.repeatCheckGrid} aria-label={language === "ko" ? `${task.title} 반복 체크` : `${task.title} repeat checks`}>
                {targetDates.map((day) => {
                  const isDone = isTaskDoneOnDate(task, day);
                  return (
                    <i
                      key={day}
                      title={`${day} ${isDone ? (language === "ko" ? "완료" : "Done") : language === "ko" ? "미완료" : "Not done"}`}
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

function ReminderTray({
  tasks,
  selectedDate,
  language,
  onToggleDone,
  onPostponeReminder,
  onCancelReminder
}: {
  tasks: Task[];
  selectedDate: string;
  language: AppLanguage;
  onToggleDone: (task: Task, date: string) => void;
  onPostponeReminder: (task: Task) => void;
  onCancelReminder: (task: Task) => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className={styles.reminderTray} aria-label={language === "ko" ? "지금 확인할 알림" : "Active reminders"}>
      <div className={styles.reminderTrayHeader}>
        <strong>{language === "ko" ? "지금 확인할 알림" : "Active Reminders"}</strong>
        <span>{language === "ko" ? `${tasks.length}개` : `${tasks.length}`}</span>
      </div>
      <div className={styles.reminderCards}>
        {tasks.slice(0, 3).map((task) => (
          <article key={task.id} className={styles.reminderCard}>
            <div>
              <span>{formatReminderLabel(task, language)}</span>
              <strong>{task.title}</strong>
            </div>
            <div className={styles.reminderActions}>
              <button type="button" onClick={() => onPostponeReminder(task)}>
                {language === "ko" ? "10분 뒤" : "10 min"}
              </button>
              <button type="button" onClick={() => onToggleDone(task, selectedDate)}>
                {language === "ko" ? "완료" : "Done"}
              </button>
              <button type="button" onClick={() => onCancelReminder(task)}>
                {language === "ko" ? "취소" : "Cancel"}
              </button>
            </div>
          </article>
        ))}
        {tasks.length > 3 && (
          <p className={styles.reminderMore}>
            {language === "ko" ? `+${tasks.length - 3}개 더 있습니다.` : `+${tasks.length - 3} more`}
          </p>
        )}
      </div>
    </section>
  );
}

function TaskRow({
  task,
  selectedDate,
  language,
  onEdit,
  onToggleDone,
  isEditing
}: {
  task: Task;
  selectedDate: string;
  language: AppLanguage;
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
        aria-label={isDone ? `${task.title} ${language === "ko" ? "완료 취소" : "mark incomplete"}` : `${task.title} ${language === "ko" ? "완료" : "mark done"}`}
        disabled={isCancelled}
        onClick={() => onToggleDone(task, selectedDate)}
      >
        {isDone ? "✓" : ""}
      </button>
      <div className={styles.taskBody}>
        <div className={styles.taskTopline}>
          {(task.reminderAt || task.time) && <span>{formatReminderLabel(task, language)}</span>}
          {isSchedulerOwned && <span className={styles.scheduleTag}>{language === "ko" ? "일정" : "Schedule"}</span>}
          {isRepeatTask(task) && <span className={styles.repeatTag}>{language === "ko" ? "반복" : "Repeat"}</span>}
          {task.dueDate && <span className={getDeadlineClass(selectedDate, task.dueDate)}>{formatDday(selectedDate, task.dueDate)}</span>}
          {task.remainingPercent < 100 && <span>{language === "ko" ? `잔여 ${task.remainingPercent}%` : `${task.remainingPercent}% left`}</span>}
        </div>
        <h3>{task.title}</h3>
      </div>
      {isSchedulerOwned ? (
        <span className={styles.readonlyLabel}>{language === "ko" ? "스케줄러" : "Read-only"}</span>
      ) : (
        <button className={styles.editButton} type="button" onClick={() => onEdit(task.id)}>
          {isEditing ? (language === "ko" ? "닫기" : "Close") : language === "ko" ? "수정" : "Edit"}
        </button>
      )}
    </article>
  );
}

type TaskEditorProps = {
  task: Task;
  selectedDate: string;
  language: AppLanguage;
  onSaveTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
};

function TaskEditor({ task, selectedDate, language, onSaveTask, onDeleteTask }: TaskEditorProps) {
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
          <p className={styles.kicker}>{language === "ko" ? "수정" : "Edit"}</p>
          <h2>{task.title}</h2>
        </div>
      </div>

      <label className={styles.formRow}>
        <span>{language === "ko" ? "할일" : "Task"}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      </label>

      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isFixed} onChange={(event) => setIsFixed(event.target.checked)} />
        {language === "ko" ? "고정 할일로 등록" : "Save as reusable task"}
      </label>

      <TaskKindFields
        language={language}
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
        <span>{language === "ko" ? "상태" : "Status"}</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
          <option value="planned">{language === "ko" ? "계획" : "Planned"}</option>
          <option value="started">{language === "ko" ? "진행 중" : "In Progress"}</option>
          <option value="done">{language === "ko" ? "완료" : "Done"}</option>
          <option value="postponed">{language === "ko" ? "연기" : "Postponed"}</option>
          <option value="cancelled">{language === "ko" ? "취소" : "Cancelled"}</option>
        </select>
      </label>

      <label className={styles.formRow}>
        <span>{language === "ko" ? "메모" : "Memo"}</span>
        <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={240} />
      </label>

      <div className={styles.progressBox}>
        <span>{language === "ko" ? "진행률" : "Progress"}</span>
        <div className={styles.progressStepper}>
          <button type="button" onClick={() => changeProgress(progress - 10)}>
            -
          </button>
          <input
            aria-label={language === "ko" ? "진행률" : "Progress"}
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
          {language === "ko" ? "삭제" : "Delete"}
        </button>
        <button type="submit" className={styles.completeButton}>
          {language === "ko" ? "저장" : "Save"}
        </button>
      </div>
    </form>
  );
}

function TaskCreateForm({
  selectedDate,
  fixedTaskTags,
  language,
  onAddTask
}: {
  selectedDate: string;
  fixedTaskTags: string[];
  language: AppLanguage;
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
        <span>{language === "ko" ? "할일" : "Task"}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={language === "ko" ? "예: 운동하기" : "e.g. Exercise"} maxLength={80} />
      </label>

      {fixedTaskTags.length > 0 && (
        <div className={styles.tagBox} aria-label={language === "ko" ? "고정 할일 태그" : "Reusable task tags"}>
          {fixedTaskTags.map((tag) => (
            <button key={tag} type="button" onClick={() => setTitle(tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}

      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isFixed} onChange={(event) => setIsFixed(event.target.checked)} />
        {language === "ko" ? "고정 할일로 등록" : "Save as reusable task"}
      </label>

      <TaskKindFields
        language={language}
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
        <span>{language === "ko" ? "메모" : "Memo"}</span>
        <textarea value={memo} onChange={(event) => setMemo(event.target.value)} maxLength={240} />
      </label>

      <button type="submit" className={styles.completeButton}>
        {language === "ko" ? "등록" : "Add"}
      </button>
    </form>
  );
}

function ScheduleCreateForm({
  selectedDate,
  language,
  onAddSchedule
}: {
  selectedDate: string;
  language: AppLanguage;
  onAddSchedule: (schedule: Schedule) => void;
}) {
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

    onAddSchedule(createCalendarSchedule({ title: trimmedTitle, startDate: date, endDate, time, isDday }));
    setTitle("");
    setTime("");
    setIsDday(false);
  }

  return (
    <form className={styles.createPanel} onSubmit={handleSubmit}>
      <label className={styles.formRow}>
        <span>{isDday ? "D-day Title" : language === "ko" ? "일정 제목" : "Schedule Title"}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={language === "ko" ? "예: 병원 예약" : "e.g. Doctor appointment"} maxLength={80} />
      </label>
      <div className={styles.formGrid}>
        <label className={styles.formRow}>
          <span>{isDday ? (language === "ko" ? "마감일" : "Due Date") : language === "ko" ? "시작일" : "Start Date"}</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>{language === "ko" ? "종료일" : "End Date"}</span>
          <input type="date" value={endDate} disabled={isDday} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>{language === "ko" ? "시간" : "Time"}</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
      </div>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isDday} onChange={(event) => setIsDday(event.target.checked)} />
        {language === "ko" ? "D-day로 표시" : "Mark as D-day"}
      </label>
      <button type="submit" className={styles.completeButton}>
        {language === "ko" ? "일정 등록" : "Add Schedule"}
      </button>
    </form>
  );
}

function SchedulePanel({
  selectedDate,
  schedules,
  language,
  onAddSchedule,
  onSaveSchedule,
  onDeleteSchedule
}: {
  selectedDate: string;
  schedules: Schedule[];
  language: AppLanguage;
  onAddSchedule: (schedule: Schedule) => void;
  onSaveSchedule: (schedule: Schedule) => void;
  onDeleteSchedule: (scheduleId: string) => void;
}) {
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const selectedSchedules = useMemo(() => getSchedulesForDate(schedules, selectedDate, true), [schedules, selectedDate]);
  const editingSchedule = selectedSchedules.find((schedule) => schedule.id === editingScheduleId) ?? null;

  return (
    <div className={styles.schedulePanel}>
      <ScheduleCreateForm selectedDate={selectedDate} language={language} onAddSchedule={onAddSchedule} />

      <section className={styles.scheduleManager}>
        <div className={styles.scheduleManagerHeader}>
          <strong>{formatDateHeading(selectedDate, language)} {language === "ko" ? "일정" : "Schedules"}</strong>
          <span>{language === "ko" ? `${selectedSchedules.length}개` : selectedSchedules.length}</span>
        </div>

        {selectedSchedules.length > 0 ? (
          <div className={styles.scheduleManageList}>
            {selectedSchedules.map((schedule) => (
              <article key={schedule.id} className={styles.scheduleManageItem}>
                <div className={styles.scheduleManageInfo}>
                  <span className={styles.scheduleTypeTag}>{getScheduleKindLabel(schedule, language)}</span>
                  <strong>{schedule.title}</strong>
                  <em>{formatScheduleRange(schedule, language)}</em>
                </div>
                <div className={styles.scheduleManageActions}>
                  <button
                    type="button"
                    onClick={() => setEditingScheduleId((current) => (current === schedule.id ? null : schedule.id))}
                  >
                    {editingScheduleId === schedule.id ? (language === "ko" ? "닫기" : "Close") : language === "ko" ? "수정" : "Edit"}
                  </button>
                  <button type="button" className={styles.deleteButton} onClick={() => onDeleteSchedule(schedule.id)}>
                    {language === "ko" ? "삭제" : "Delete"}
                  </button>
                </div>
                {editingSchedule?.id === schedule.id && (
                  <ScheduleEditor
                    schedule={editingSchedule}
                    language={language}
                    onSaveSchedule={(nextSchedule) => {
                      onSaveSchedule(nextSchedule);
                      setEditingScheduleId(null);
                    }}
                  />
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.emptyState}>{language === "ko" ? "이 날짜에 등록된 일정이 없습니다." : "No schedules on this date."}</p>
        )}
      </section>
    </div>
  );
}

function ScheduleEditor({
  schedule,
  language,
  onSaveSchedule
}: {
  schedule: Schedule;
  language: AppLanguage;
  onSaveSchedule: (schedule: Schedule) => void;
}) {
  const [title, setTitle] = useState(schedule.title);
  const [startDate, setStartDate] = useState(schedule.startDate);
  const [endDate, setEndDate] = useState(schedule.endDate);
  const [time, setTime] = useState(schedule.time ?? "");
  const [isDday, setIsDday] = useState(schedule.kind === "deadline");
  const [status, setStatus] = useState(schedule.status);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const normalizedEndDate = endDate >= startDate ? endDate : startDate;
    onSaveSchedule({
      ...schedule,
      title: trimmedTitle,
      startDate,
      endDate: isDday ? startDate : normalizedEndDate,
      time: time || null,
      kind: isDday ? "deadline" : normalizedEndDate === startDate ? "date" : "period",
      status,
      reminderAt: schedule.reminderAt ?? null,
      calendarColor: isDday ? fixedKindColors.dday : fixedKindColors.today,
      updatedAt: new Date().toISOString()
    });
  }

  return (
    <form className={styles.scheduleEditor} onSubmit={handleSubmit}>
      <label className={styles.formRow}>
        <span>{isDday ? "D-day Title" : language === "ko" ? "일정 제목" : "Schedule Title"}</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      </label>
      <div className={styles.formGrid}>
        <label className={styles.formRow}>
          <span>{isDday ? (language === "ko" ? "마감일" : "Due Date") : language === "ko" ? "시작일" : "Start Date"}</span>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>{language === "ko" ? "종료일" : "End Date"}</span>
          <input type="date" value={endDate} disabled={isDday} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>{language === "ko" ? "시간" : "Time"}</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label className={styles.formRow}>
          <span>{language === "ko" ? "상태" : "Status"}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as Schedule["status"])}>
            <option value="planned">{language === "ko" ? "예정" : "Planned"}</option>
            <option value="done">{language === "ko" ? "완료" : "Done"}</option>
            <option value="cancelled">{language === "ko" ? "취소" : "Cancelled"}</option>
          </select>
        </label>
      </div>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isDday} onChange={(event) => setIsDday(event.target.checked)} />
        {language === "ko" ? "D-day로 표시" : "Mark as D-day"}
      </label>
      <button type="submit" className={styles.completeButton}>
        {language === "ko" ? "일정 저장" : "Save Schedule"}
      </button>
    </form>
  );
}

type TaskKindFieldsProps = {
  language: AppLanguage;
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
  language,
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
      <div className={styles.kindGrid} role="radiogroup" aria-label={language === "ko" ? "일정 종류" : "Task type"}>
        {kindOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={taskKind === option.id}
            className={taskKind === option.id ? `${styles.kindButton} ${styles.selectedKind}` : styles.kindButton}
            onClick={() => onTaskKindChange(option.id)}
          >
            <strong>{option.label[language]}</strong>
            <span>{option.description[language]}</span>
          </button>
        ))}
      </div>

      {taskKind === "no_deadline" && <p className={styles.fieldHint}>{language === "ko" ? "날짜 없이 보관되는 할일입니다." : "This task is stored without a date."}</p>}

      {taskKind === "today" && (
        <div className={styles.formGrid}>
          <label className={styles.formRow}>
            <span>{language === "ko" ? "날짜" : "Date"}</span>
            <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
          </label>
          <label className={styles.formRow}>
            <span>{language === "ko" ? "시간" : "Time"}</span>
            <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
          </label>
        </div>
      )}

      {taskKind === "dday" && (
        <div className={styles.formGrid}>
          <label className={styles.formRow}>
            <span>{language === "ko" ? "마감일" : "Due Date"}</span>
            <input type="date" value={dueDate} onChange={(event) => onDueDateChange(event.target.value)} />
          </label>
          <label className={styles.formRow}>
            <span>{language === "ko" ? "시작시간" : "Start Time"}</span>
            <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
          </label>
        </div>
      )}

      {taskKind === "repeat" && (
        <>
          <div className={styles.formGrid}>
            <label className={styles.formRow}>
              <span>{language === "ko" ? "진행 기간 시작" : "Period Start"}</span>
              <input type="date" value={periodStartDate} onChange={(event) => onPeriodStartDateChange(event.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>{language === "ko" ? "진행 기간 종료" : "Period End"}</span>
              <input type="date" value={periodEndDate} onChange={(event) => onPeriodEndDateChange(event.target.value)} />
            </label>
            <label className={styles.formRow}>
              <span>{language === "ko" ? "시작시간" : "Start Time"}</span>
              <input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
            </label>
          </div>

          <RepeatFields
            language={language}
            repeatKind={repeatKind}
            repeatDaysOfWeek={repeatDaysOfWeek}
            repeatDayOfMonth={repeatDayOfMonth}
            onRepeatKindChange={onRepeatKindChange}
            onRepeatDaysChange={onRepeatDaysChange}
            onRepeatDayOfMonthChange={onRepeatDayOfMonthChange}
          />

          <fieldset className={styles.colorField}>
            <legend>{language === "ko" ? "달력 색상" : "Calendar Color"}</legend>
            <div className={styles.colorGrid}>
              {repeatCalendarColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={language === "ko" ? `반복 색상 ${color}` : `Repeat color ${color}`}
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
  language,
  repeatKind,
  repeatDaysOfWeek,
  repeatDayOfMonth,
  onRepeatKindChange,
  onRepeatDaysChange,
  onRepeatDayOfMonthChange
}: {
  language: AppLanguage;
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
        <span>{language === "ko" ? "반복" : "Repeat"}</span>
        <select value={repeatKind} onChange={(event) => onRepeatKindChange(event.target.value as RepeatKind)}>
          <option value="daily">{language === "ko" ? "매일" : "Daily"}</option>
          <option value="weekly">{language === "ko" ? "요일 반복" : "Weekly"}</option>
          <option value="date_range">{language === "ko" ? "특정 기간" : "Date Range"}</option>
          <option value="monthly">{language === "ko" ? "매월" : "Monthly"}</option>
        </select>
      </label>

      {repeatKind === "weekly" && (
        <div className={styles.weekdayGrid} aria-label={language === "ko" ? "반복 요일" : "Repeat weekdays"}>
          {(language === "ko"
            ? [["일", 0], ["월", 1], ["화", 2], ["수", 3], ["목", 4], ["금", 5], ["토", 6]]
            : [["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6]]
          ).map(([label, value]) => (
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
          <span>{language === "ko" ? "매월 반복일" : "Monthly Day"}</span>
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

function getScheduleTasksForDate(schedules: Schedule[], date: string) {
  return schedules
    .filter((schedule) => schedule.status !== "cancelled")
    .map((schedule) => scheduleToTask(schedule, date))
    .filter((task): task is Task => Boolean(task));
}

function getSchedulesForDate(schedules: Schedule[], date: string, includeCancelled = false) {
  return schedules
    .filter((schedule) => includeCancelled || schedule.status !== "cancelled")
    .filter((schedule) => {
      if (schedule.kind === "deadline") {
        const dday = daysBetween(date, schedule.startDate);
        return dday >= 0 && dday <= 3;
      }

      return date >= schedule.startDate && date <= schedule.endDate;
    })
    .sort((a, b) => {
      const timeDiff = (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
      if (timeDiff !== 0) return timeDiff;
      return a.title.localeCompare(b.title, "ko-KR");
    });
}

function scheduleToTask(schedule: Schedule, date: string): Task | null {
  if (schedule.kind === "deadline") {
    const dday = daysBetween(date, schedule.startDate);
    if (dday < 0 || dday > 3) return null;
  } else if (date < schedule.startDate || date > schedule.endDate) {
    return null;
  }

  return {
    id: `schedule-task-${schedule.id}`,
    title: schedule.title,
    date: schedule.kind === "deadline" || schedule.kind === "period" ? null : schedule.startDate,
    dueDate: schedule.kind === "deadline" ? schedule.startDate : null,
    periodStartDate: schedule.kind === "period" ? schedule.startDate : null,
    periodEndDate: schedule.kind === "period" ? schedule.endDate : null,
    time: schedule.time,
    source: schedule.kind === "deadline" ? "deadline" : "manual",
    status: schedule.status === "done" ? "done" : schedule.status === "cancelled" ? "cancelled" : "planned",
    priority: "normal",
    todaySortGroup: schedule.time ? "timed_today" : schedule.kind === "deadline" ? "near_deadline" : "pulled_to_today",
    taskKindOption: schedule.kind === "deadline" ? "dday" : "today",
    owner: "schedule",
    postponeCount: 0,
    progressPercent: schedule.status === "done" ? 100 : 0,
    remainingPercent: schedule.status === "done" ? 0 : 100,
    reminderAt: schedule.reminderAt ?? null,
    parentTaskId: null,
    scheduleId: schedule.id,
    calendarColor: schedule.calendarColor,
    repeatKind: "none",
    repeatDaysOfWeek: [],
    repeatDayOfMonth: null,
    completedDates: [],
    isGenerated: false,
    isManuallyEdited: false,
    memo: schedule.memo ?? ""
  };
}

function migrateScheduleTasks(tasks: Task[]) {
  return tasks.filter(isSchedulerOwnedTask).map(taskToSchedule);
}

function taskToSchedule(task: Task): Schedule {
  const startDate = task.dueDate ?? task.periodStartDate ?? task.date ?? getLocalDateKey();
  const endDate = task.periodEndDate ?? startDate;
  const now = new Date().toISOString();

  return {
    id: task.scheduleId ?? task.id.replace(/^task-/, "schedule-"),
    title: task.title,
    startDate,
    endDate,
    time: task.time,
    kind: task.dueDate ? "deadline" : task.periodStartDate && task.periodEndDate && task.periodEndDate !== task.periodStartDate ? "period" : "date",
    status: task.status === "done" ? "done" : task.status === "cancelled" ? "cancelled" : "planned",
    reminderAt: task.reminderAt,
    calendarColor: task.calendarColor ?? (task.dueDate ? fixedKindColors.dday : fixedKindColors.today),
    linkedTaskId: task.id,
    createdAt: now,
    updatedAt: now,
    memo: task.memo
  };
}

function mergeSchedules(...groups: Schedule[][]) {
  const scheduleMap = new Map<string, Schedule>();
  groups.flat().filter(isSchedule).forEach((schedule) => {
    scheduleMap.set(schedule.id, schedule);
  });
  return Array.from(scheduleMap.values()).sort((a, b) => {
    const dateDiff = a.startDate.localeCompare(b.startDate);
    if (dateDiff !== 0) return dateDiff;
    return (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
  });
}

function isSchedule(value: unknown): value is Schedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<Schedule>;
  return (
    typeof schedule.id === "string" &&
    typeof schedule.title === "string" &&
    typeof schedule.startDate === "string" &&
    typeof schedule.endDate === "string" &&
    (schedule.kind === "date" || schedule.kind === "deadline" || schedule.kind === "period")
  );
}

function getScheduleKindLabel(schedule: Schedule, language: AppLanguage = "ko") {
  if (schedule.kind === "deadline") return "D-day";
  if (schedule.kind === "period") return language === "ko" ? "기간" : "Period";
  return language === "ko" ? "일정" : "Event";
}

function formatScheduleRange(schedule: Schedule, language: AppLanguage = "ko") {
  const dateLabel = schedule.kind === "deadline" ? formatDday(getLocalDateKey(), schedule.startDate) : schedule.startDate === schedule.endDate ? schedule.startDate : `${schedule.startDate} ~ ${schedule.endDate}`;
  const timeLabel = schedule.time ? ` · ${schedule.time}` : "";
  const statusLabel =
    schedule.status === "done"
      ? language === "ko"
        ? " · 완료"
        : " · Done"
      : schedule.status === "cancelled"
        ? language === "ko"
          ? " · 취소"
          : " · Cancelled"
        : "";
  return `${dateLabel}${timeLabel}${statusLabel}`;
}

function getTaskSourceLabel(task: Task, language: AppLanguage) {
  if (task.source === "deadline") return "D-day";
  if (task.source === "routine") return language === "ko" ? "반복" : "Repeat";
  return language === "ko" ? "할일" : "Task";
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

function getCalendarTextSchedules(schedules: Schedule[], date: string) {
  return schedules
    .filter((schedule) => {
      if (schedule.status === "cancelled") return false;
      if (schedule.kind === "deadline") return schedule.startDate === date;
      return date >= schedule.startDate && date <= schedule.endDate;
    })
    .sort((a, b) => {
      const timeDiff = (a.time ?? "99:99").localeCompare(b.time ?? "99:99");
      if (timeDiff !== 0) return timeDiff;
      return a.title.localeCompare(b.title, "ko-KR");
    });
}

function getCalendarProgressTasks(tasks: Task[], schedules: Schedule[], date: string) {
  return [...getTasksForDate(tasks, date), ...getScheduleTasksForDate(schedules, date)].filter((task) => task.source !== "no_date");
}

function createCalendarSchedule({
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
}): Schedule {
  const normalizedEndDate = endDate >= startDate ? endDate : startDate;
  const isPeriod = !isDday && normalizedEndDate !== startDate;
  const now = new Date().toISOString();

  return {
    id: `schedule-${Date.now()}`,
    title,
    startDate,
    endDate: isDday ? startDate : normalizedEndDate,
    time: time || null,
    kind: isDday ? "deadline" : isPeriod ? "period" : "date",
    status: "planned",
    reminderAt: null,
    calendarColor: isDday ? fixedKindColors.dday : fixedKindColors.today,
    linkedTaskId: null,
    createdAt: now,
    updatedAt: now,
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

function formatDateTitle(date: string, language: AppLanguage = "ko") {
  const today = "2026-06-02";
  if (date === today) return language === "ko" ? "오늘" : "Today";
  if (date === shiftDate(today, -1)) return language === "ko" ? "어제" : "Yesterday";
  if (date === shiftDate(today, 1)) return language === "ko" ? "내일" : "Tomorrow";

  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
    month: "long",
    day: "numeric",
    weekday: "short"
  });
}

function formatDateHeading(date: string, language: AppLanguage = "ko") {
  return new Date(`${date}T00:00:00`).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
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

function formatReminderLabel(task: Task, language: AppLanguage = "ko") {
  const suffix = language === "ko" ? "알림" : "reminder";
  if (task.reminderAt) return `${formatReminderTime(task.reminderAt)} ${suffix}`;
  if (task.time) return `${task.time} ${suffix}`;
  return "";
}

function getNotificationPermission(): ReminderPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function getNotificationStatusLabel(permission: ReminderPermission) {
  if (permission === "unsupported") return "이 브라우저에서는 알림을 사용할 수 없습니다.";
  if (permission === "granted") return "시간이 있는 할일과 일정은 앱이 열려 있거나 PWA로 실행 중일 때 알림을 보냅니다.";
  if (permission === "denied") return "브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 권한을 바꿔야 합니다.";
  return "시간이 있는 할일과 일정 알림을 받으려면 브라우저 알림 권한을 켜야 합니다.";
}

function getNotificationStatusLabelEn(permission: ReminderPermission) {
  if (permission === "unsupported") return "This browser does not support notifications.";
  if (permission === "granted") return "Timed tasks and schedules notify while the app is open or running as a PWA.";
  if (permission === "denied") return "Notifications are blocked. Change permission in your browser settings.";
  return "Enable browser notifications to receive timed task and schedule reminders.";
}

function getInstallStatusLabel(state: InstallState, language: AppLanguage) {
  if (language === "en") {
    if (state === "available") return "This app can be installed and used like a standalone app.";
    if (state === "installed") return "The app is already running as an installed app.";
    return "If your browser supports installation, use its install menu.";
  }

  if (state === "available") return "설치해서 독립 앱처럼 사용할 수 있습니다.";
  if (state === "installed") return "이미 설치된 앱으로 실행 중입니다.";
  return "브라우저가 지원하면 주소창이나 메뉴에서 설치할 수 있습니다.";
}

function getInstallHintLabel(state: InstallState, language: AppLanguage) {
  if (language === "en") {
    if (state === "available") return "Use the button here, or install from your browser address bar.";
    if (state === "installed") return "The installed app opens in its own window and keeps the same local data.";
    return "Chrome or Edge may show Install App in the address bar or browser menu.";
  }

  if (state === "available") return "아래 버튼으로 설치하거나 브라우저 주소창의 설치 아이콘을 사용할 수 있습니다.";
  if (state === "installed") return "설치 앱은 별도 창으로 열리고 같은 로컬 데이터를 사용합니다.";
  return "Chrome 또는 Edge 주소창/메뉴에서 앱 설치 항목이 보일 수 있습니다.";
}

function getInstallActionLabel(state: InstallState, language: AppLanguage) {
  if (language === "en") {
    if (state === "available") return "Install App";
    if (state === "installed") return "Installed";
    return "Use Browser Menu";
  }

  if (state === "available") return "앱 설치";
  if (state === "installed") return "설치됨";
  return "브라우저 메뉴에서 설치";
}

async function checkInstallReadiness(): Promise<InstallReadiness> {
  const readiness: InstallReadiness = {
    secureContext: window.isSecureContext,
    manifest: false,
    icons: false,
    serviceWorker: false
  };

  try {
    const manifestHref = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    if (manifestHref) {
      const response = await fetch(manifestHref, { cache: "no-store" });
      const manifest = (await response.json()) as Partial<{ name: string; short_name: string; display: string; icons: Array<{ sizes?: string }> }>;
      readiness.manifest = Boolean(manifest.name && manifest.short_name && manifest.display === "standalone");
      readiness.icons = Array.isArray(manifest.icons) && manifest.icons.some((icon) => icon.sizes?.includes("192")) && manifest.icons.some((icon) => icon.sizes?.includes("512"));
    }
  } catch {
    readiness.manifest = false;
    readiness.icons = false;
  }

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      readiness.serviceWorker = Boolean(registration);
    }
  } catch {
    readiness.serviceWorker = false;
  }

  return readiness;
}

function getAuthMessageLabel(message: string, language: AppLanguage) {
  if (language === "ko") return message;
  if (message === "Google Drive 설정 필요") return "Google Drive setup required.";
  if (message === "Google Drive 연결 준비됨") return "Google Drive is ready to connect.";
  if (message.includes("OAuth 클라이언트 ID")) return "Add your Google OAuth client ID to .env.";
  if (message.includes("연결 중")) return "Connecting to Google Drive.";
  if (message.includes("동기화 중")) return "Syncing with Google Drive.";
  if (message.includes("동기화 완료")) return message.replace("Google Drive 동기화 완료", "Google Drive synced");
  if (message.includes("현재 데이터가 다릅니다")) return "Drive data differs from current data. Choose which data to keep.";
  if (message.includes("Drive 데이터를 불러오는 중")) return "Loading data from Drive.";
  if (message.includes("현재 데이터를 Drive에 저장하는 중")) return "Saving current data to Drive.";
  if (message.includes("Drive 충돌을 해결하지 못했습니다")) return "Could not resolve the Drive data conflict. Please reconnect.";
  if (message.includes("Drive 데이터를 불러왔습니다")) return "Drive data loaded. Reloading the app.";
  if (message.includes("복구할 Drive 이전 데이터가 없습니다")) return "No pre-Drive recovery data is available.";
  if (message.includes("연결이 만료")) return "The Drive connection expired. Please reconnect.";
  if (message.includes("연결을 완료하지 못했습니다")) return "Could not connect to Google Drive.";
  return message;
}

function scheduleBrowserReminders(tasks: Task[], selectedDate: string, firedKeys: Set<string>) {
  const now = Date.now();
  const maxDelay = 1000 * 60 * 60 * 24;

  return tasks.flatMap((task) => {
    if (task.status === "done" || task.status === "cancelled") return [];

    const remindAt = getTaskReminderDate(task, selectedDate);
    if (!remindAt) return [];

    const delay = remindAt.getTime() - now;
    if (delay <= 0 || delay > maxDelay) return [];

    const reminderKey = `${task.id}-${remindAt.toISOString()}`;
    if (firedKeys.has(reminderKey)) return [];

    const timer = window.setTimeout(() => {
      firedKeys.add(reminderKey);
      showTaskNotification(task);
    }, delay);

    return [timer];
  });
}

function getDueReminderTasks(tasks: Task[], selectedDate: string, now: number) {
  if (selectedDate > getLocalDateKey()) return [];

  return tasks
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .filter((task) => {
      const remindAt = getTaskReminderDate(task, selectedDate);
      return remindAt ? remindAt.getTime() <= now : false;
    })
    .sort((a, b) => {
      const aTime = getTaskReminderDate(a, selectedDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = getTaskReminderDate(b, selectedDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
}

function getTaskReminderDate(task: Task, selectedDate: string) {
  if (task.reminderAt) {
    const reminderDate = new Date(task.reminderAt);
    return Number.isNaN(reminderDate.getTime()) ? null : reminderDate;
  }

  if (!task.time) return null;

  const reminderDate = new Date(`${selectedDate}T${task.time}:00`);
  return Number.isNaN(reminderDate.getTime()) ? null : reminderDate;
}

function showTaskNotification(task: Task) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const notification = new Notification(task.title, {
    body: "딱 5분만 시작해요.",
    icon: "./icon.svg",
    tag: `dont-forget-${task.id}`
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function CalendarTab({
  tasks,
  schedules,
  dailyNotes,
  selectedDate,
  language,
  onDateChange,
  onToggleDone,
  onSaveDailyNote,
  onOpenTasks
}: {
  tasks: Task[];
  schedules: Schedule[];
  dailyNotes: DailyNote[];
  selectedDate: string;
  language: AppLanguage;
  onDateChange: (date: string) => void;
  onToggleDone: (task: Task, date: string) => void;
  onSaveDailyNote: (date: string, text: string) => void;
  onOpenTasks: () => void;
}) {
  const monthDays = getMonthDays(selectedDate);
  const records = getMonthlyRecords(tasks, schedules, selectedDate);
  const learnedWords = readWordProgressCount();
  const dailyFocus = readDailyFocusCount();
  const selectedSchedules = getCalendarTextSchedules(schedules, selectedDate);
  const selectedProgressTasks = getCalendarProgressTasks(tasks, schedules, selectedDate);
  const selectedTaskItems = selectedProgressTasks.filter((task) => task.owner !== "schedule");
  const selectedScheduleTaskById = new Map(
    selectedProgressTasks
      .filter((task) => task.owner === "schedule" && task.scheduleId)
      .map((task) => [task.scheduleId as string, task])
  );
  const selectedDoneCount = selectedProgressTasks.filter((task) => isTaskDoneOnDate(task, selectedDate)).length;
  const selectedTotalCount = selectedProgressTasks.length;
  const selectedRate = selectedTotalCount === 0 ? 0 : Math.round((selectedDoneCount / selectedTotalCount) * 100);
  const selectedDailyNote = dailyNotes.find((note) => note.date === selectedDate);
  const selectedNote = selectedDailyNote?.text ?? "";
  const noteDates = new Set(dailyNotes.map((note) => note.date));
  const monthKey = selectedDate.slice(0, 7);
  const monthlyDailyNotes = dailyNotes
    .filter((note) => note.date.startsWith(monthKey))
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthTitle = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "long"
  });

  function openDate(date: string) {
    onDateChange(date);
  }

  return (
    <section className={styles.mainPanel}>
      <div className={styles.sectionHeader}>
        <div className={styles.titleNav} aria-label={language === "ko" ? "월 이동" : "Month navigation"}>
          <button type="button" aria-label={language === "ko" ? "이전 달" : "Previous month"} onClick={() => onDateChange(shiftMonth(selectedDate, -1))}>
            &lt;
          </button>
          <h2>{monthTitle}</h2>
          <button type="button" aria-label={language === "ko" ? "다음 달" : "Next month"} onClick={() => onDateChange(shiftMonth(selectedDate, 1))}>
            &gt;
          </button>
        </div>
      </div>
      <div className={styles.calendarGrid} aria-label={`${monthTitle} ${language === "ko" ? "달력" : "calendar"}`}>
        {(language === "ko" ? ["일", "월", "화", "수", "목", "금", "토"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((label, index) => (
          <div key={label} className={index === 0 ? `${styles.calendarDow} ${styles.sunday}` : styles.calendarDow}>
            {label}
          </div>
        ))}
        {monthDays.map((day, index) => {
          if (!day) return <div key={`blank-${index}`} className={`${styles.calendarCell} ${styles.blankCell}`} />;

          const daySchedules = getCalendarTextSchedules(schedules, day);
          const progressTasks = getCalendarProgressTasks(tasks, schedules, day);
          const progressDoneCount = progressTasks.filter((task) => isTaskDoneOnDate(task, day)).length;
          const progressRate = progressTasks.length === 0 ? 0 : Math.round((progressDoneCount / progressTasks.length) * 100);
          const isDayComplete = progressTasks.length > 0 && progressDoneCount === progressTasks.length;
          const isSelected = day === selectedDate;
          const hasDailyNote = noteDates.has(day);
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
              <span className={styles.calendarCellTop}>
                <span className={date.getDay() === 0 ? `${styles.calendarDay} ${styles.sunday}` : styles.calendarDay}>
                  {date.getDate()}
                </span>
                {progressTasks.length > 0 && (
                  <span className={styles.calendarStats} aria-label={language === "ko" ? `일정 ${progressTasks.length}개, 진척률 ${progressRate}%` : `${progressTasks.length} items, ${progressRate}% done`}>
                    <span>{progressTasks.length}</span>
                    <span>{progressRate}%</span>
                  </span>
                )}
              </span>
              <span className={styles.calendarTextList}>
                {daySchedules.slice(0, 3).map((schedule) => (
                  <span
                    key={schedule.id}
                    className={schedule.kind === "deadline" ? styles.calendarDeadlineText : ""}
                    title={[
                      schedule.time,
                      schedule.title,
                      schedule.kind === "deadline" ? formatDday(day, schedule.startDate) : ""
                    ].filter(Boolean).join(" · ")}
                  >
                    {schedule.time ? `${schedule.time} ` : ""}
                    {schedule.title}
                    {schedule.kind === "deadline" ? ` · ${formatDday(day, schedule.startDate)}` : ""}
                  </span>
                ))}
                {daySchedules.length > 3 && <span>+{daySchedules.length - 3}</span>}
              </span>
              {progressTasks.length > 0 && (
                <span className={styles.calendarBar} aria-label={language === "ko" ? `진척률 ${progressDoneCount}/${progressTasks.length}` : `Progress ${progressDoneCount}/${progressTasks.length}`}>
                  <i style={{ width: `${progressRate}%` }} />
                </span>
              )}
              {hasDailyNote && (
                <span className={styles.calendarNoteDot} aria-label={language === "ko" ? "기록 있음" : "Has note"} />
              )}
            </button>
          );
        })}
      </div>
      <section className={styles.calendarSelectedList}>
        <div className={styles.calendarSelectedHeader}>
          <div>
            <h3>{language === "ko" ? `${formatDateHeading(selectedDate, language)} 일정` : `${formatDateHeading(selectedDate, language)} Items`}</h3>
            <span className={styles.calendarSelectedMeta}>
              {language === "ko"
                ? `완료 ${selectedDoneCount}/${selectedTotalCount} · ${selectedRate}%`
                : `${selectedDoneCount}/${selectedTotalCount} done · ${selectedRate}%`}
            </span>
          </div>
          <button type="button" onClick={onOpenTasks}>
            {language === "ko" ? "할일에서 보기" : "Open tasks"}
          </button>
        </div>
        {[...selectedSchedules, ...selectedTaskItems].length > 0 ? (
          <div>
            {selectedSchedules.map((schedule) => (
              <article key={schedule.id} className={schedule.status === "done" ? styles.calendarSelectedDone : ""}>
                <button
                  type="button"
                  className={styles.calendarSelectedCheck}
                  aria-label={language === "ko" ? `${schedule.title} 완료 전환` : `Toggle ${schedule.title}`}
                  onClick={() => {
                    const task = selectedScheduleTaskById.get(schedule.id);
                    if (task) onToggleDone(task, selectedDate);
                  }}
                >
                  ✓
                </button>
                <div>
                  <strong>
                    {schedule.time ? `${schedule.time} ` : ""}
                    {schedule.title}
                  </strong>
                  <span>{schedule.kind === "deadline" ? formatDday(selectedDate, schedule.startDate) : getScheduleKindLabel(schedule, language)}</span>
                </div>
              </article>
            ))}
            {selectedTaskItems.map((task) => (
              <article key={`${task.id}-${task.date ?? selectedDate}`} className={isTaskDoneOnDate(task, selectedDate) ? styles.calendarSelectedDone : ""}>
                <button
                  type="button"
                  className={styles.calendarSelectedCheck}
                  aria-label={language === "ko" ? `${task.title} 완료 전환` : `Toggle ${task.title}`}
                  onClick={() => onToggleDone(task, selectedDate)}
                >
                  ✓
                </button>
                <div>
                  <strong>{task.time ? `${task.time} ${task.title}` : task.title}</strong>
                  <span>{isTaskDoneOnDate(task, selectedDate) ? (language === "ko" ? "완료" : "Done") : getTaskSourceLabel(task, language)}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>{language === "ko" ? "이 날짜에 표시할 일정이 없습니다." : "No items for this date."}</p>
        )}
      </section>
      <section className={styles.dailyNoteBox}>
        <div className={styles.dailyNoteHeader}>
          <div>
            <strong>{language === "ko" ? `${formatDateHeading(selectedDate, language)} 기록` : `${formatDateHeading(selectedDate, language)} Note`}</strong>
            <span>
              {selectedDailyNote
                ? language === "ko"
                  ? `${formatDailyNoteSavedAt(selectedDailyNote.updatedAt)} 저장됨`
                  : `Saved ${formatDailyNoteSavedAt(selectedDailyNote.updatedAt)}`
                : language === "ko"
                  ? "특별한 일이나 실제로 한 일을 남겨두기"
                  : "Capture what happened or what you actually did."}
            </span>
          </div>
          {selectedDailyNote && (
            <button type="button" onClick={() => onSaveDailyNote(selectedDate, "")}>
              {language === "ko" ? "기록 지우기" : "Clear Note"}
            </button>
          )}
        </div>
        <textarea
          value={selectedNote}
          onChange={(event) => onSaveDailyNote(selectedDate, event.target.value)}
          onInput={(event) => onSaveDailyNote(selectedDate, event.currentTarget.value)}
          placeholder={language === "ko" ? "예: 산책하고 카페에서 책 읽음. 생각보다 컨디션 좋았음." : "Ex: Took a walk and read at a cafe. Felt better than expected."}
          rows={3}
        />
        {monthlyDailyNotes.length > 0 && (
          <div className={styles.monthNoteList}>
            <strong>{language === "ko" ? "이번 달에 쓴 기록" : "Notes This Month"}</strong>
            <div>
              {monthlyDailyNotes.map((note) => (
                <button
                  key={note.date}
                  type="button"
                  className={note.date === selectedDate ? styles.activeMonthNote : ""}
                  onClick={() => onDateChange(note.date)}
                >
                  <span>{formatDateHeading(note.date, language)}</span>
                  <em>{note.text.replace(/\s+/g, " ").slice(0, 32)}</em>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className={styles.recordSummary}>
        <div className={styles.recordSummaryHeader}>
          <strong>{language === "ko" ? "이번 달 기록" : "Monthly Records"}</strong>
          <span>{records.completionRate}%</span>
        </div>
        <div className={styles.recordBar} aria-label={language === "ko" ? `완료율 ${records.completionRate}%` : `Completion ${records.completionRate}%`}>
          <i style={{ width: `${records.completionRate}%` }} />
        </div>
        <div className={styles.recordGrid}>
          <RecordItem label={language === "ko" ? "완료" : "Done"} value={`${records.done}/${records.total}`} />
          <RecordItem label={language === "ko" ? "미완료" : "Not Done"} value={String(records.notDone)} />
          <RecordItem label={language === "ko" ? "연기" : "Postponed"} value={String(records.postponed)} />
          <RecordItem label={language === "ko" ? "취소" : "Cancelled"} value={String(records.cancelled)} />
          <RecordItem label={language === "ko" ? "집중" : "Focus"} value={String(dailyFocus)} />
          <RecordItem label={language === "ko" ? "단어" : "Words"} value={String(learnedWords)} />
        </div>
      </section>
    </section>
  );
}

function getMonthlyRecords(tasks: Task[], schedules: Schedule[], selectedDate: string) {
  const monthKey = selectedDate.slice(0, 7);
  const monthDays = getMonthDays(selectedDate).filter((day): day is string => Boolean(day));
  const monthlyTasks = monthDays.flatMap((day) => getTasksForDate(tasks, day));
  const monthlySchedules = schedules.filter((schedule) =>
    schedule.endDate >= `${monthKey}-01` && schedule.startDate <= monthDays[monthDays.length - 1]
  );
  const monthlyScheduleTasks = monthDays.flatMap((day) => getScheduleTasksForDate(monthlySchedules, day));
  const allItems = [...monthlyTasks, ...monthlyScheduleTasks];
  const uniqueItems = dedupeTasksByDate(allItems);
  const done = uniqueItems.filter((task) => isTaskDoneInMonth(task, monthKey)).length;
  const postponed = uniqueItems.filter((task) => isTaskActionInMonth(task.postponedAt, monthKey)).length;
  const cancelled = uniqueItems.filter((task) => isTaskActionInMonth(task.cancelledAt, monthKey)).length;
  const total = uniqueItems.length;

  return {
    total,
    done,
    postponed,
    cancelled,
    notDone: Math.max(0, total - done),
    completionRate: total === 0 ? 0 : Math.round((done / total) * 100)
  };
}

function isTaskDoneInMonth(task: Task, monthKey: string) {
  if (task.completedAt) return isTaskActionInMonth(task.completedAt, monthKey);
  if (task.completedDates?.some((date) => date.startsWith(monthKey))) return true;
  if (task.status !== "done") return false;
  return task.date?.startsWith(monthKey) || task.dueDate?.startsWith(monthKey);
}

function isTaskActionInMonth(value: string | null | undefined, monthKey: string) {
  return typeof value === "string" && value.slice(0, 7) === monthKey;
}

function dedupeTasksByDate(tasks: Task[]) {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = `${task.id}-${task.date ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readWordProgressCount() {
  const value = readLocalStorageJson(learnedWordsStorageKey);
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && "seenCount" in item).length : 0;
}

function readDailyFocusCount() {
  const value = readLocalStorageJson(dailyFocusStorageKey);
  if (!value || typeof value !== "object") return 0;
  const record = value as Partial<{ date: string; count: number }>;
  return record.date === getLocalDateKey() && typeof record.count === "number" ? Math.max(0, Math.round(record.count)) : 0;
}


function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getInitialAppTab(): AppTab {
  const view = new URLSearchParams(window.location.search).get("view") ?? "";
  return viewParamToTab[view] ?? "plan";
}

function getInitialInstallState(): InstallState {
  if (window.matchMedia("(display-mode: standalone)").matches) return "installed";
  if ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone) return "installed";
  return "unavailable";
}

function getTabViewParam(tab: AppTab) {
  if (tab === "pomodoro") return "timer";
  return tab;
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

function backupAppData(tasks: Task[], schedules: Schedule[]) {
  const payload = {
    app: "잊지 마",
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    schedules,
    localStorage: {
      settings: readLocalStorageJson(appSettingsStorageKey),
      wordProgress: readLocalStorageJson(learnedWordsStorageKey),
      memos: readLocalStorageJson(memoStorageKey),
      planBlocks: readLocalStorageJson(planBlocksStorageKey),
      timerSettings: readLocalStorageJson(timerSettingsStorageKey),
      dailyFocus: readLocalStorageJson(dailyFocusStorageKey),
      dailyNotes: readLocalStorageJson(dailyNotesStorageKey)
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

async function restoreAppData(file: File, language: AppLanguage, onRecoverySaved: (createdAt: string) => void) {
  const invalidMessage =
    language === "ko"
      ? "잊지 마에서 만든 올바른 백업 JSON 파일이 아닙니다."
      : "This is not a valid Don't Forget backup JSON file.";
  const failedMessage =
    language === "ko"
      ? "백업 파일을 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요."
      : "The backup file could not be read. Check that it is not damaged.";

  if (file.size > 10 * 1024 * 1024) {
    window.alert(language === "ko" ? "백업 파일은 10MB 이하여야 합니다." : "Backup files must be 10MB or smaller.");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    window.alert(failedMessage);
    return;
  }

  if (!isAppBackupPayload(payload)) {
    window.alert(invalidMessage);
    return;
  }

  const confirmed = window.confirm(
    language === "ko"
      ? `이 백업은 ${formatBackupDate(payload.exportedAt)}에 만들어졌습니다.\n현재 데이터를 백업 내용으로 교체할까요?`
      : `This backup was created on ${formatBackupDate(payload.exportedAt)}.\nReplace the current data with this backup?`
  );
  if (!confirmed) return;

  try {
    onRecoverySaved(saveLocalRecovery("restore"));
    saveStoredTasks(payload.tasks);
    saveStoredSchedules(payload.schedules);
    restoreLocalStorageValue(appSettingsStorageKey, payload.localStorage?.settings);
    restoreLocalStorageValue(learnedWordsStorageKey, payload.localStorage?.wordProgress);
    restoreLocalStorageValue(memoStorageKey, payload.localStorage?.memos);
    restoreLocalStorageValue(planBlocksStorageKey, payload.localStorage?.planBlocks);
    restoreLocalStorageValue(timerSettingsStorageKey, payload.localStorage?.timerSettings);
    restoreLocalStorageValue(dailyFocusStorageKey, payload.localStorage?.dailyFocus);
    restoreLocalStorageValue(dailyNotesStorageKey, payload.localStorage?.dailyNotes);
    window.alert(language === "ko" ? "백업을 복원했습니다. 앱을 다시 불러옵니다." : "Backup restored. The app will reload.");
    window.location.reload();
  } catch {
    window.alert(failedMessage);
  }
}

function isAppBackupPayload(value: unknown): value is AppBackupPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<AppBackupPayload>;
  return (
    payload.app === "잊지 마" &&
    payload.version === 1 &&
    typeof payload.exportedAt === "string" &&
    !Number.isNaN(new Date(payload.exportedAt).getTime()) &&
    Array.isArray(payload.tasks) &&
    payload.tasks.every(isBackupTask) &&
    Array.isArray(payload.schedules) &&
    payload.schedules.every(isSchedule) &&
    (payload.localStorage === undefined || (payload.localStorage !== null && typeof payload.localStorage === "object"))
  );
}

function isBackupTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<Task>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    (task.date === null || typeof task.date === "string") &&
    (task.dueDate === null || typeof task.dueDate === "string") &&
    (task.time === null || typeof task.time === "string") &&
    (task.source === "manual" || task.source === "routine" || task.source === "deadline" || task.source === "no_date") &&
    (task.status === "planned" || task.status === "started" || task.status === "done" || task.status === "postponed" || task.status === "cancelled")
  );
}

function restoreLocalStorageValue(key: string, value: unknown) {
  if (value === undefined) return;
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

function formatBackupDate(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function deleteAppData(language: AppLanguage, onDeleted: (createdAt: string) => void) {
  const confirmed = window.confirm(
    language === "ko"
      ? "저장된 할일, 일정, 단어 기록, 메모, 계획표 루틴을 삭제할까요?\n삭제 직전 데이터는 자동 복구본으로 보관됩니다."
      : "Delete saved tasks, schedules, word progress, memos, and planner routines?\nA recovery point will be saved first."
  );
  if (!confirmed) return;

  const recoveryCreatedAt = saveLocalRecovery("delete");
  try {
    saveStoredTasks([]);
    saveStoredSchedules([]);
    window.localStorage.setItem(learnedWordsStorageKey, JSON.stringify([]));
    window.localStorage.setItem(memoStorageKey, JSON.stringify([]));
    window.localStorage.setItem(planBlocksStorageKey, JSON.stringify([]));
    window.localStorage.setItem(dailyNotesStorageKey, JSON.stringify([]));
    window.localStorage.removeItem(dailyFocusStorageKey);
  } finally {
    onDeleted(recoveryCreatedAt);
  }
}

function formatSyncTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatDailyNoteSavedAt(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function readLocalStorageJson(key: string) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
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
    return [];
  }

  return [];
}

function saveStoredPlanBlocks(blocks: PlanBlock[]) {
  try {
    window.localStorage.setItem(planBlocksStorageKey, JSON.stringify(blocks));
  } catch {
    // Plan persistence should never block the app shell.
  }
}

function loadStoredDailyNotes() {
  try {
    const rawValue = window.localStorage.getItem(dailyNotesStorageKey);
    if (rawValue) {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) return parsed.filter(isDailyNote);
    }
  } catch {
    return [];
  }

  return [];
}

function saveStoredDailyNotes(notes: DailyNote[]) {
  try {
    window.localStorage.setItem(dailyNotesStorageKey, JSON.stringify(notes));
  } catch {
    // Daily notes should never block task usage.
  }
}

function isDailyNote(value: unknown): value is DailyNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<DailyNote>;
  return typeof note.date === "string" && typeof note.text === "string" && typeof note.updatedAt === "string";
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
