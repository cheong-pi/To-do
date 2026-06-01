import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { sortTodayTasks } from "./todayRules";
import styles from "./TodayView.module.css";
import { isFirebaseConfigured, signInWithGoogle, signOutUser, subscribeAuthState } from "../../services/firebase";
import { saveUserTasks, subscribeUserTasks } from "../../services/taskCloudStorage";
import { loadStoredTasks, saveStoredTasks } from "../../services/taskStorage";
import type { RepeatKind, Task, TaskKindOption, TaskSource, TaskStatus, TodaySortGroup } from "../../types/task";
import type { User } from "firebase/auth";

type AppTab = "tasks" | "calendar" | "words" | "pomodoro";

const tabs: Array<{ id: AppTab; label: string }> = [
  { id: "tasks", label: "할일" },
  { id: "calendar", label: "캘린더" },
  { id: "words", label: "단어" },
  { id: "pomodoro", label: "뽀모도로" }
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

export function TodayView() {
  const [activeTab, setActiveTab] = useState<AppTab>("tasks");
  const [tasks, setTasks] = useState<Task[]>(() => loadStoredTasks());
  const [selectedDate, setSelectedDate] = useState("2026-06-02");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authMessage, setAuthMessage] = useState(
    isFirebaseConfigured() ? "Google 로그인 준비됨" : "Firebase 설정 필요"
  );
  const isApplyingRemoteTasks = useRef(false);
  const hasReceivedRemoteTasks = useRef(false);

  const todayTasks = useMemo(() => sortTodayTasks(getTasksForDate(tasks, selectedDate)), [tasks, selectedDate]);
  const doneCount = todayTasks.filter((task) => task.status === "done").length;
  const unfinishedCount = todayTasks.length - doneCount;
  const doneRate = todayTasks.length === 0 ? 0 : Math.round((doneCount / todayTasks.length) * 100);
  const editingTask = tasks.find((task) => task.id === editingTaskId) ?? null;
  const fixedTaskTags = useMemo(() => getFixedTaskTags(tasks), [tasks]);

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

  function toggleTaskDone(task: Task) {
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
    setIsAddingTask(false);
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
          <p className={styles.kicker}>습관 기르기 앱</p>
          <h1>잊지 마</h1>
          <p className={styles.summary}>오늘 할 일을 먼저 보고, 단어와 뽀모도로는 탭으로 분리합니다.</p>
        </div>
        <button className={styles.loginCard} type="button" onClick={handleGoogleLogin}>
          <span>{authUser ? "Google 로그아웃" : "Google 로그인"}</span>
          <strong>{authMessage}</strong>
        </button>
      </header>

      <nav className={styles.tabs} aria-label="주요 화면">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? styles.activeTab : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "tasks" && (
        <TasksTab
          todayTasks={todayTasks}
          doneCount={doneCount}
          unfinishedCount={unfinishedCount}
          doneRate={doneRate}
          editingTask={editingTask}
          isAddingTask={isAddingTask}
          fixedTaskTags={fixedTaskTags}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onShowAddTask={() => setIsAddingTask((current) => !current)}
          onAddTask={addTask}
          onEdit={setEditingTaskId}
          onCloseEdit={() => setEditingTaskId(null)}
          onToggleDone={toggleTaskDone}
          onSaveTask={saveTask}
          onDeleteTask={deleteTask}
        />
      )}

      {activeTab === "calendar" && <CalendarTab />}
      {activeTab === "words" && <WordsTab />}
      {activeTab === "pomodoro" && <PomodoroTab />}
    </main>
  );
}

type TasksTabProps = {
  todayTasks: Task[];
  doneCount: number;
  unfinishedCount: number;
  doneRate: number;
  editingTask: Task | null;
  isAddingTask: boolean;
  fixedTaskTags: string[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  onShowAddTask: () => void;
  onAddTask: (task: Task) => void;
  onEdit: (taskId: string) => void;
  onCloseEdit: () => void;
  onToggleDone: (task: Task) => void;
  onSaveTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
};

function TasksTab({
  todayTasks,
  doneCount,
  unfinishedCount,
  doneRate,
  editingTask,
  isAddingTask,
  fixedTaskTags,
  selectedDate,
  onDateChange,
  onShowAddTask,
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
            </div>
            <p>동그라미를 다시 누르면 완료를 되돌리고, 수정에서 내용과 일정 종류를 바꿀 수 있어요.</p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.compactSummary} aria-label="오늘 완료율">
              <span>완료 {doneCount}</span>
              <span>미완료 {unfinishedCount}</span>
              <strong>{doneRate}%</strong>
            </div>
            <button className={styles.addInlineButton} type="button" onClick={onShowAddTask}>
              {isAddingTask ? "등록 닫기" : "할일 등록"}
            </button>
          </div>
        </div>

        {isAddingTask && <TaskCreateForm selectedDate={selectedDate} fixedTaskTags={fixedTaskTags} onAddTask={onAddTask} />}

        <div className={styles.listMeta}>
          <span className={styles.countBadge}>{todayTasks.length}/15</span>
        </div>

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
              {editingTask?.id === task.id && (
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
      </section>
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
  onToggleDone: (task: Task) => void;
  isEditing: boolean;
}) {
  const isCancelled = task.status === "cancelled";

  return (
    <article className={`${styles.taskRow} ${styles[task.status]}`} aria-disabled={isCancelled}>
      <button
        className={styles.taskCheck}
        type="button"
        aria-label={task.status === "done" ? `${task.title} 완료 취소` : `${task.title} 완료`}
        disabled={isCancelled}
        onClick={() => onToggleDone(task)}
      >
        {task.status === "done" ? "✓" : ""}
      </button>
      <div className={styles.taskBody}>
        <div className={styles.taskTopline}>
          {(task.reminderAt || task.time) && <span>{formatReminderLabel(task)}</span>}
          {isRepeatTask(task) && <span className={styles.repeatTag}>반복</span>}
          {task.dueDate && <span className={getDeadlineClass(selectedDate, task.dueDate)}>{formatDday(selectedDate, task.dueDate)}</span>}
          {task.remainingPercent < 100 && <span>잔여 {task.remainingPercent}%</span>}
        </div>
        <h3>{task.title}</h3>
      </div>
      <button className={styles.editButton} type="button" onClick={() => onEdit(task.id)}>
        {isEditing ? "닫기" : "수정"}
      </button>
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
        <label className={styles.formRow}>
          <span>마감일</span>
          <input type="date" value={dueDate} onChange={(event) => onDueDateChange(event.target.value)} />
        </label>
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
            <legend>캘린더 색상</legend>
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
    if (task.dueDate && daysBetween(date, task.dueDate) >= 0 && daysBetween(date, task.dueDate) <= 5) return true;
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
      time: null,
      source: "deadline",
      todaySortGroup: "near_deadline",
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

function CalendarTab() {
  return (
    <section className={styles.mainPanel}>
      <h2>캘린더</h2>
      <p className={styles.placeholderText}>완료, 연기, 취소 흐름을 월 단위로 확인하는 화면입니다.</p>
    </section>
  );
}

function WordsTab() {
  return (
    <section className={styles.mainPanel}>
      <h2>단어</h2>
      <p className={styles.placeholderText}>초중등 영어 3000개 기준으로 20개 학습 후 틀린 단어를 반복합니다.</p>
      <div className={styles.wordProgress}>
        <span>오늘 학습</span>
        <strong>0 / 20</strong>
      </div>
    </section>
  );
}

function PomodoroTab() {
  return (
    <section className={styles.mainPanel}>
      <h2>뽀모도로</h2>
      <p className={styles.placeholderText}>집중 시간, 휴식 시간, 반복 횟수를 그때그때 선택하는 실행 모드입니다.</p>
      <div className={styles.timerGrid}>
        <span>집중 25분</span>
        <span>휴식 5분</span>
        <span>반복 4회</span>
      </div>
    </section>
  );
}
