import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { sortTodayTasks } from "./todayRules";
import styles from "./TodayView.module.css";
import { isFirebaseConfigured, signInWithGoogle, signOutUser, subscribeAuthState } from "../../services/firebase";
import { saveUserTasks, subscribeUserTasks } from "../../services/taskCloudStorage";
import { loadStoredSchedules, saveStoredSchedules } from "../../services/scheduleStorage";
import { loadStoredTasks, saveStoredTasks } from "../../services/taskStorage";
import { saveUserAppData, subscribeUserAppData } from "../../services/userAppDataCloudStorage";
import type { RepeatKind, Schedule, Task, TaskKindOption, TaskOwner, TaskSource, TaskStatus, TodaySortGroup } from "../../types/task";
import type { User } from "firebase/auth";

type AppTab = "plan" | "tasks" | "calendar" | "words" | "pomodoro" | "memo" | "settings";

type AppLanguage = "ko" | "en";

type FontMode = "default" | "system";

type ReminderPermission = NotificationPermission | "unsupported";

const WordsTab = lazy(() => import("./WordsTab"));

type AppSettings = {
  language: AppLanguage;
  fontMode: FontMode;
};

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

export function TodayView() {
  const [activeTab, setActiveTab] = useState<AppTab>("plan");
  const [appLanguage, setAppLanguage] = useState<AppLanguage>(() => loadAppSettings().language);
  const [fontMode, setFontMode] = useState<FontMode>(() => loadAppSettings().fontMode);
  const [notificationPermission, setNotificationPermission] = useState<ReminderPermission>(() => getNotificationPermission());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [dataResetToken, setDataResetToken] = useState(0);
  const [hasOpenedWords, setHasOpenedWords] = useState(false);
  const initialTasks = useMemo(() => loadStoredTasks(), []);
  const [tasks, setTasks] = useState<Task[]>(() => initialTasks.filter((task) => !isSchedulerOwnedTask(task)));
  const [schedules, setSchedules] = useState<Schedule[]>(() =>
    mergeSchedules(loadStoredSchedules(), migrateScheduleTasks(initialTasks))
  );
  const [selectedDate, setSelectedDate] = useState("2026-06-02");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [activeCreatePanel, setActiveCreatePanel] = useState<"task" | "schedule" | null>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authMessage, setAuthMessage] = useState(
    isFirebaseConfigured() ? "Google 로그인 준비됨" : "Firebase 설정 필요"
  );
  const isApplyingRemoteTasks = useRef(false);
  const hasReceivedRemoteTasks = useRef(false);
  const isApplyingRemoteSettings = useRef(false);
  const hasReceivedRemoteSettings = useRef(false);
  const isApplyingRemoteSchedules = useRef(false);
  const hasReceivedRemoteSchedules = useRef(false);
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
    if (activeTab === "words") setHasOpenedWords(true);
  }, [activeTab]);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;

    return subscribeAuthState((user) => {
      setAuthUser(user);
      hasReceivedRemoteTasks.current = false;
      hasReceivedRemoteSettings.current = false;
      hasReceivedRemoteSchedules.current = false;
      setAuthMessage(user ? `${user.displayName ?? "Google"} 동기화 중` : "Google 로그인 준비됨");
    });
  }, []);

  useEffect(() => {
    if (!authUser) return;

    const localSettings: AppSettings = { language: appLanguage, fontMode };

    return subscribeUserAppData<AppSettings>(
      authUser.uid,
      "settings",
      (remoteSettings) => {
        if (!remoteSettings && !hasReceivedRemoteSettings.current) {
          void saveUserAppData(authUser.uid, "settings", localSettings);
          hasReceivedRemoteSettings.current = true;
          return;
        }

        hasReceivedRemoteSettings.current = true;
        if (!remoteSettings) return;

        isApplyingRemoteSettings.current = true;
        setAppLanguage(remoteSettings.language === "en" ? "en" : "ko");
        setFontMode(remoteSettings.fontMode === "system" ? "system" : "default");
      },
      () => {
        setAuthMessage("동기화 오류: 설정은 로컬에 저장 중");
      }
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;

    return subscribeUserTasks(
      authUser.uid,
      (remoteTasks) => {
        const remoteAppTasks = remoteTasks.filter((task) => !isSchedulerOwnedTask(task));
        const remoteSchedules = migrateScheduleTasks(remoteTasks);

        if (remoteAppTasks.length === 0 && !hasReceivedRemoteTasks.current && tasks.length > 0) {
          void saveUserTasks(authUser.uid, tasks);
          hasReceivedRemoteTasks.current = true;
          setAuthMessage(`${authUser.displayName ?? "Google"} 동기화 완료`);
          return;
        }

        hasReceivedRemoteTasks.current = true;
        isApplyingRemoteTasks.current = true;
        setTasks(remoteAppTasks);
        if (remoteSchedules.length > 0) {
          setSchedules((current) => mergeSchedules(current, remoteSchedules));
        }
        setAuthMessage(`${authUser.displayName ?? "Google"} 동기화 완료`);
      },
      () => {
        setAuthMessage("동기화 오류: 로컬 저장 중");
      }
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;

    return subscribeUserAppData<Schedule[]>(
      authUser.uid,
      "schedules",
      (remoteSchedules) => {
        if (!remoteSchedules && !hasReceivedRemoteSchedules.current && schedules.length > 0) {
          void saveUserAppData(authUser.uid, "schedules", schedules);
          hasReceivedRemoteSchedules.current = true;
          return;
        }

        hasReceivedRemoteSchedules.current = true;
        if (!remoteSchedules) return;

        isApplyingRemoteSchedules.current = true;
        setSchedules(remoteSchedules.filter(isSchedule));
      },
      () => {
        setAuthMessage("동기화 오류: 일정을 로컬에 저장 중");
      }
    );
  }, [authUser]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      if (isApplyingRemoteSettings.current) {
        isApplyingRemoteSettings.current = false;
        return;
      }

      if (authUser && hasReceivedRemoteSettings.current) {
        void saveUserAppData(authUser.uid, "settings", { language: appLanguage, fontMode }).catch(() => {
          setAuthMessage("동기화 오류: 설정은 로컬에 저장 중");
        });
      }
    }, 400);

    return () => window.clearTimeout(saveTimer);
  }, [authUser, appLanguage, fontMode]);

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
    const saveTimer = window.setTimeout(() => {
      if (!authUser || !hasReceivedRemoteSchedules.current || isApplyingRemoteSchedules.current) return;
      void saveUserAppData(authUser.uid, "schedules", schedules).catch(() => {
        setAuthMessage("동기화 오류: 일정을 로컬에 저장 중");
      });
    }, 400);

    return () => window.clearTimeout(saveTimer);
  }, [authUser, schedules]);

  useEffect(() => {
    saveStoredTasks(tasks);
    if (isApplyingRemoteTasks.current) {
      isApplyingRemoteTasks.current = false;
    }
  }, [tasks]);

  useEffect(() => {
    saveStoredSchedules(schedules);
    if (isApplyingRemoteSchedules.current) {
      isApplyingRemoteSchedules.current = false;
    }
  }, [schedules]);

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
      reminderAt: nextReminderAt
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
      reminderAt: null
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

  async function handleNotificationRequest() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    const nextPermission = await Notification.requestPermission();
    setNotificationPermission(nextPermission);
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
        cloudUserId={authUser?.uid ?? null}
        onCloudMessage={setAuthMessage}
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
          selectedDate={selectedDate}
          language={appLanguage}
          onDateChange={setSelectedDate}
          onOpenTasks={() => setActiveTab("tasks")}
        />
      )}
      {hasOpenedWords && (
        <Suspense
          fallback={
            activeTab === "words" ? (
              <section className={styles.mainPanel}>
                <div className={styles.vocabDone}>
                  <strong>{appLanguage === "ko" ? "단어장 불러오는 중" : "Loading Vocabulary"}</strong>
                </div>
              </section>
            ) : null
          }
        >
          <WordsTab
            isActive={activeTab === "words"}
            language={appLanguage}
            dataResetToken={dataResetToken}
            cloudUserId={authUser?.uid ?? null}
            onCloudMessage={setAuthMessage}
          />
        </Suspense>
      )}
      <PomodoroTab tasks={todayTasks} selectedDate={selectedDate} isActive={activeTab === "pomodoro"} language={appLanguage} />
      <MemoTab isActive={activeTab === "memo"} language={appLanguage} cloudUserId={authUser?.uid ?? null} onCloudMessage={setAuthMessage} />
      {activeTab === "settings" && (
        <SettingsTab
          language={appLanguage}
          fontMode={fontMode}
          authUser={authUser}
          authMessage={authMessage}
          onLanguageChange={setAppLanguage}
          onFontModeChange={setFontMode}
          notificationPermission={notificationPermission}
          onNotificationRequest={handleNotificationRequest}
          onBackup={() => backupAppData(tasks, schedules)}
          onDeleteData={() =>
            void deleteAppData(authUser?.uid ?? null, () => {
              setTasks([]);
              setSchedules([]);
              setDataResetToken((current) => current + 1);
            })
          }
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

function SettingsTab({
  language,
  fontMode,
  authUser,
  authMessage,
  onLanguageChange,
  onFontModeChange,
  notificationPermission,
  onNotificationRequest,
  onBackup,
  onDeleteData,
  onGoogleLogin
}: {
  language: AppLanguage;
  fontMode: FontMode;
  authUser: User | null;
  authMessage: string;
  onLanguageChange: (language: AppLanguage) => void;
  onFontModeChange: (fontMode: FontMode) => void;
  notificationPermission: ReminderPermission;
  onNotificationRequest: () => void;
  onBackup: () => void;
  onDeleteData: () => void;
  onGoogleLogin: () => void;
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
            <button type="button" className={`${styles.settingsAction} ${styles.dangerAction}`} onClick={onDeleteData}>
              {language === "ko" ? "데이터 삭제하기" : "Delete Data"}
            </button>
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
            <h3>{language === "ko" ? "계정" : "Account"}</h3>
            <p>{getAuthMessageLabel(authMessage, language)}</p>
            <span className={styles.syncScope}>
              {language === "ko"
                ? "동기화 대상: 할일, 설정, 계획표, 단어 기록, 메모"
                : "Syncs: tasks, schedules, settings, planner, word progress, memos"}
            </span>
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
                <li>잊지 마는 생활 루틴, 할일, 일정, 단어 외우기와 타이머를 한 흐름에서 관리하는 실행 관리 앱입니다.</li>
                <li>설정: 앱 표시 방식, 계정, 백업, 데이터 삭제를 관리합니다.</li>
                <li>계획표: 생활 루틴과 시간 있는 할일을 한 시간표에서 봅니다.</li>
                <li>할일: 오늘 처리할 일을 관리하고, 일정은 읽기용으로 함께 확인합니다.</li>
                <li>일정 등록: 날짜 일정, 기간 일정, D-day를 별도 일정 데이터로 저장합니다.</li>
                <li>달력: 반복은 실제 완료한 날만 색칠하고, 일반 일정은 날짜 칸에 텍스트로 표시합니다.</li>
                <li>단어 외우기: 먼저 외우고, 퀴즈로 확인하며, 복습 단어가 다시 섞입니다.</li>
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

function PlanTab({
  tasks,
  selectedDate,
  language,
  isActive,
  cloudUserId,
  onCloudMessage
}: {
  tasks: Task[];
  selectedDate: string;
  language: AppLanguage;
  isActive: boolean;
  cloudUserId: string | null;
  onCloudMessage: (message: string) => void;
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
  const isApplyingRemotePlanBlocks = useRef(false);
  const hasReceivedRemotePlanBlocks = useRef(false);

  useEffect(() => {
    if (!cloudUserId) {
      hasReceivedRemotePlanBlocks.current = false;
      return;
    }

    return subscribeUserAppData<PlanBlock[]>(
      cloudUserId,
      "planBlocks",
      (remotePlanBlocks) => {
        if (!remotePlanBlocks && !hasReceivedRemotePlanBlocks.current && planBlocks.length > 0) {
          void saveUserAppData(cloudUserId, "planBlocks", planBlocks);
          hasReceivedRemotePlanBlocks.current = true;
          return;
        }

        hasReceivedRemotePlanBlocks.current = true;
        if (!remotePlanBlocks) return;

        isApplyingRemotePlanBlocks.current = true;
        setPlanBlocks(remotePlanBlocks.filter(isPlanBlock));
      },
      () => onCloudMessage("동기화 오류: 계획표는 로컬에 저장 중")
    );
  }, [cloudUserId]);

  useEffect(() => {
    saveStoredPlanBlocks(planBlocks);
    if (isApplyingRemotePlanBlocks.current) {
      isApplyingRemotePlanBlocks.current = false;
      return;
    }

    if (cloudUserId && hasReceivedRemotePlanBlocks.current) {
      void saveUserAppData(cloudUserId, "planBlocks", planBlocks).catch(() => {
        onCloudMessage("동기화 오류: 계획표는 로컬에 저장 중");
      });
    }
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
        {timelineItems.map((item) => (
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
        ))}
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
          {todayTasks.map((task) => (
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
          ))}
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

function getAuthMessageLabel(message: string, language: AppLanguage) {
  if (language === "ko") return message;
  if (message === "Firebase 설정 필요") return "Firebase setup required.";
  if (message === "Google 로그인 준비됨") return "Google sign-in ready.";
  if (message.includes("Firebase 설정값")) return "Add Firebase values to .env to sign in.";
  if (message.includes("동기화 오류")) return "Sync error: saving locally.";
  if (message.endsWith("동기화 중")) return `${message.replace(" 동기화 중", "")} syncing`;
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
  selectedDate,
  language,
  onDateChange,
  onOpenTasks
}: {
  tasks: Task[];
  schedules: Schedule[];
  selectedDate: string;
  language: AppLanguage;
  onDateChange: (date: string) => void;
  onOpenTasks: () => void;
}) {
  const monthDays = getMonthDays(selectedDate);
  const monthTitle = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(language === "ko" ? "ko-KR" : "en-US", {
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
                <span className={styles.calendarStats} aria-label={language === "ko" ? `일정 ${progressTasks.length}개, 진척률 ${progressRate}%` : `${progressTasks.length} items, ${progressRate}% done`}>
                  {progressTasks.length} · {progressRate}%
                </span>
              )}
              <span className={styles.calendarTextList}>
                {daySchedules.slice(0, 3).map((schedule) => (
                  <span key={schedule.id} className={schedule.kind === "deadline" ? styles.calendarDeadlineText : ""}>
                    {schedule.time ? `${schedule.time} ` : ""}
                    {schedule.kind === "deadline" ? `${formatDday(day, schedule.startDate)} ` : ""}
                    {schedule.title}
                  </span>
                ))}
                {daySchedules.length > 3 && <span>+{daySchedules.length - 3}</span>}
              </span>
              {progressTasks.length > 0 && (
                <span className={styles.calendarBar} aria-label={language === "ko" ? `진척률 ${progressDoneCount}/${progressTasks.length}` : `Progress ${progressDoneCount}/${progressTasks.length}`}>
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


function PomodoroTab({
  tasks,
  selectedDate,
  isActive,
  language
}: {
  tasks: Task[];
  selectedDate: string;
  isActive: boolean;
  language: AppLanguage;
}) {
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
  const timerLabel = isBreakTimer ? (language === "ko" ? "휴식" : "Break") : language === "ko" ? "집중" : "Focus";
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
          window.setTimeout(() => window.alert(language === "ko" ? "집중 시간이 끝났어요." : "Focus time is over."), 0);
        }
        if (timerMode === "break") {
          window.setTimeout(() => window.alert(language === "ko" ? "휴식 시간이 끝났어요." : "Break time is over."), 0);
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
      <h2>{language === "ko" ? "타이머" : "Timer"}</h2>
      <div className={styles.pomodoroPanel}>
        <div className={styles.pomoModes} aria-label={language === "ko" ? "타이머 모드" : "Timer mode"}>
          <button
            type="button"
            className={!isBreakTimer ? styles.activePomoMode : ""}
            onClick={() => {
              if (!isEditingSettings) return;
              setTimerPreset("focus");
              setRemainingSeconds(focusMinutes * 60);
            }}
          >
            {language === "ko" ? "집중" : "Focus"}
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
            {language === "ko" ? "휴식" : "Break"}
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
            <span>{language === "ko" ? "집중" : "Focus"}</span>
            <input
              type="number"
              min="1"
              max="180"
              value={focusMinutes}
              disabled={!isEditingSettings}
              onChange={(event) => updateFocusMinutes(Number(event.target.value))}
            />
            <em>{language === "ko" ? "분" : "min"}</em>
          </label>
          <label>
            <span>{language === "ko" ? "휴식" : "Break"}</span>
            <input
              type="number"
              min="1"
              max="60"
              value={breakMinutes}
              disabled={!isEditingSettings}
              onChange={(event) => updateBreakMinutes(Number(event.target.value))}
            />
            <em>{language === "ko" ? "분" : "min"}</em>
          </label>
          <label>
            <span>{language === "ko" ? "반복" : "Sets"}</span>
            <input
              type="number"
              min="1"
              max="12"
              value={targetSets}
              disabled={!isEditingSettings}
              onChange={(event) => updateTargetSets(Number(event.target.value))}
            />
            <em>{language === "ko" ? "회" : "sets"}</em>
          </label>
        </div>

        <div className={styles.timerActions}>
          {timerMode === "idle" && (
            <>
              <button type="button" onClick={startSelectedPreset}>{remainingSeconds === 0 ? (language === "ko" ? "다시 시작" : "Restart") : language === "ko" ? "시작" : "Start"}</button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "리셋" : "Reset"}</button>
            </>
          )}
          {timerMode === "focus" && (
            <>
              <button type="button" onClick={() => setIsRunning((current) => !current)}>{isRunning ? (language === "ko" ? "잠깐 멈춤" : "Pause") : language === "ko" ? "다시 시작" : "Resume"}</button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "리셋" : "Reset"}</button>
            </>
          )}
          {timerMode === "break" && (
            <>
              <button type="button" onClick={() => setIsRunning((current) => !current)}>{isRunning ? (language === "ko" ? "잠깐 멈춤" : "Pause") : language === "ko" ? "다시 시작" : "Resume"}</button>
              <button type="button" onClick={resetTimer}>{language === "ko" ? "리셋" : "Reset"}</button>
            </>
          )}
        </div>

        <div className={styles.pomoDots}>
          {Array.from({ length: Math.min(targetSets, 12) }).map((_, index) => (
            <span key={index} className={index < completedSets ? styles.activePomoDot : ""} />
          ))}
          <strong>{language === "ko" ? `오늘 ${completedSets}회 집중` : `${completedSets} focus sessions today`}</strong>
        </div>

        <label className={styles.pomoFocus}>
          <span>{language === "ko" ? "지금 집중할 일" : "Focus Task"}</span>
          <select value={focusTaskId} onChange={(event) => setFocusTaskId(event.target.value)}>
            <option value="">{language === "ko" ? "선택 안 함" : "No task selected"}</option>
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

function MemoTab({
  isActive,
  language,
  cloudUserId,
  onCloudMessage
}: {
  isActive: boolean;
  language: AppLanguage;
  cloudUserId: string | null;
  onCloudMessage: (message: string) => void;
}) {
  const [memos, setMemos] = useState<Memo[]>(() => loadStoredMemos());
  const [content, setContent] = useState("");
  const isApplyingRemoteMemos = useRef(false);
  const hasReceivedRemoteMemos = useRef(false);

  useEffect(() => {
    if (!cloudUserId) {
      hasReceivedRemoteMemos.current = false;
      return;
    }

    return subscribeUserAppData<Memo[]>(
      cloudUserId,
      "memos",
      (remoteMemos) => {
        if (!remoteMemos && !hasReceivedRemoteMemos.current && memos.length > 0) {
          void saveUserAppData(cloudUserId, "memos", memos);
          hasReceivedRemoteMemos.current = true;
          return;
        }

        hasReceivedRemoteMemos.current = true;
        if (!remoteMemos) return;

        isApplyingRemoteMemos.current = true;
        setMemos(remoteMemos.filter(isMemo));
      },
      () => onCloudMessage("동기화 오류: 메모는 로컬에 저장 중")
    );
  }, [cloudUserId]);

  useEffect(() => {
    saveStoredMemos(memos);
    if (isApplyingRemoteMemos.current) {
      isApplyingRemoteMemos.current = false;
      return;
    }

    if (cloudUserId && hasReceivedRemoteMemos.current) {
      void saveUserAppData(cloudUserId, "memos", memos).catch(() => {
        onCloudMessage("동기화 오류: 메모는 로컬에 저장 중");
      });
    }
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
    <section className={styles.mainPanel} hidden={!isActive}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>{language === "ko" ? "메모" : "Memo"} <span className={styles.titleCount}>{memos.length}</span></h2>
        </div>
      </div>

      <form className={styles.memoComposer} onSubmit={addMemo}>
        <textarea
          value={content}
          maxLength={600}
          placeholder={language === "ko" ? "예: 다음에 병원 예약할 때 필요한 서류 확인하기" : "e.g. Documents needed for the next appointment"}
          onChange={(event) => setContent(event.target.value)}
        />
        <button type="submit">{language === "ko" ? "메모 추가" : "Add Memo"}</button>
      </form>

      <div className={styles.memoList}>
        {memos.length > 0 ? (
          memos.map((memo) => (
            <article key={memo.id} className={styles.memoItem}>
              <p>{memo.content}</p>
              <div>
                <time>{formatMemoTime(memo.createdAt)}</time>
                <button type="button" onClick={() => deleteMemo(memo.id)}>{language === "ko" ? "삭제" : "Delete"}</button>
              </div>
            </article>
          ))
        ) : (
          <p className={styles.emptyMemo}>{language === "ko" ? "아직 메모가 없어요." : "No memos yet."}</p>
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


function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

async function deleteAppData(userId: string | null, onDeleted: () => void) {
  const confirmed = window.confirm("저장된 할일, 단어 기록, 메모, 계획표 루틴을 삭제할까요? 설정값은 유지됩니다.");
  if (!confirmed) return;

  try {
    saveStoredTasks([]);
    saveStoredSchedules([]);
    window.localStorage.setItem(learnedWordsStorageKey, JSON.stringify([]));
    window.localStorage.setItem(memoStorageKey, JSON.stringify([]));
    window.localStorage.setItem(planBlocksStorageKey, JSON.stringify([]));
    if (userId) {
      await Promise.all([
        saveUserTasks(userId, []),
        saveUserAppData(userId, "schedules", []),
        saveUserAppData(userId, "wordProgress", []),
        saveUserAppData(userId, "memos", []),
        saveUserAppData(userId, "planBlocks", [])
      ]);
    }
  } finally {
    onDeleted();
  }
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

