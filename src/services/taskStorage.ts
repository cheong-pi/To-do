import type { Task } from "../types/task";

const storageKey = "dont-forget.tasks.v1";

type StoredTasks = {
  version: 1;
  tasks: unknown[];
};

export function loadStoredTasks(): Task[] {
  if (!canUseStorage()) return [];

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<StoredTasks>;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.map(normalizeTask).filter((task): task is Task => task !== null);
  } catch {
    return [];
  }
}

export function saveStoredTasks(tasks: Task[]) {
  if (!canUseStorage()) return;

  const payload: StoredTasks = {
    version: 1,
    tasks
  };

  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function normalizeTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<Task>;
  if (typeof task.id !== "string" || typeof task.title !== "string") return null;

  const progressPercent = clampPercent(task.progressPercent);
  return {
    id: task.id,
    title: task.title,
    date: isNullableString(task.date) ? task.date ?? null : null,
    dueDate: isNullableString(task.dueDate) ? task.dueDate ?? null : null,
    periodStartDate: isNullableString(task.periodStartDate) ? task.periodStartDate : null,
    periodEndDate: isNullableString(task.periodEndDate) ? task.periodEndDate : null,
    time: isNullableString(task.time) ? task.time ?? null : null,
    source: isTaskSource(task.source) ? task.source : "manual",
    status: isTaskStatus(task.status) ? task.status : "planned",
    priority: task.priority === "high" || task.priority === "low" ? task.priority : "normal",
    todaySortGroup: isTodaySortGroup(task.todaySortGroup) ? task.todaySortGroup : null,
    taskKindOption: task.taskKindOption,
    owner: task.owner,
    postponeCount: isFiniteNumber(task.postponeCount) ? Math.max(0, Math.floor(task.postponeCount)) : 0,
    progressPercent,
    remainingPercent: isFiniteNumber(task.remainingPercent)
      ? clampPercent(task.remainingPercent)
      : 100 - progressPercent,
    reminderAt: isValidDateTime(task.reminderAt) ? task.reminderAt : null,
    parentTaskId: isNullableString(task.parentTaskId) ? task.parentTaskId ?? null : null,
    scheduleId: isNullableString(task.scheduleId) ? task.scheduleId : null,
    isFixed: Boolean(task.isFixed),
    calendarColor: typeof task.calendarColor === "string" ? task.calendarColor : undefined,
    routineId: isNullableString(task.routineId) ? task.routineId : null,
    routineRuleId: isNullableString(task.routineRuleId) ? task.routineRuleId : null,
    repeatKind: task.repeatKind,
    repeatDaysOfWeek: Array.isArray(task.repeatDaysOfWeek)
      ? task.repeatDaysOfWeek.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      : [],
    repeatDayOfMonth: isFiniteNumber(task.repeatDayOfMonth) ? task.repeatDayOfMonth : null,
    completedDates: Array.isArray(task.completedDates)
      ? task.completedDates.filter((date): date is string => typeof date === "string")
      : [],
    completedAt: isNullableString(task.completedAt) ? task.completedAt : null,
    postponedAt: isNullableString(task.postponedAt) ? task.postponedAt : null,
    cancelledAt: isNullableString(task.cancelledAt) ? task.cancelledAt : null,
    isGenerated: Boolean(task.isGenerated),
    isManuallyEdited: Boolean(task.isManuallyEdited),
    memo: typeof task.memo === "string" ? task.memo : ""
  };
}

function isValidDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampPercent(value: unknown) {
  if (!isFiniteNumber(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isTaskSource(value: unknown): value is Task["source"] {
  return value === "manual" || value === "routine" || value === "deadline" || value === "no_date";
}

function isTaskStatus(value: unknown): value is Task["status"] {
  return value === "planned" || value === "started" || value === "done" || value === "postponed" || value === "cancelled";
}

function isTodaySortGroup(value: unknown): value is Task["todaySortGroup"] {
  return (
    value === "timed_today" ||
    value === "pulled_to_today" ||
    value === "repeat_today" ||
    value === "near_deadline" ||
    value === "started" ||
    value === "no_date"
  );
}
