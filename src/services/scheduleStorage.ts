import type { Schedule } from "../types/task";

const storageKey = "dont-forget.schedules.v1";

type StoredSchedules = {
  version: 1;
  schedules: unknown[];
};

export function loadStoredSchedules(): Schedule[] {
  if (!canUseStorage()) return [];

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSchedules>;
    if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) return [];
    return parsed.schedules.map(normalizeSchedule).filter((schedule): schedule is Schedule => schedule !== null);
  } catch {
    return [];
  }
}

export function saveStoredSchedules(schedules: Schedule[]) {
  if (!canUseStorage()) return;

  const payload: StoredSchedules = {
    version: 1,
    schedules
  };

  window.localStorage.setItem(storageKey, JSON.stringify(payload));
}

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function normalizeSchedule(value: unknown): Schedule | null {
  if (!value || typeof value !== "object") return null;
  const schedule = value as Partial<Schedule>;
  if (
    typeof schedule.id !== "string" ||
    typeof schedule.title !== "string" ||
    !isDateKey(schedule.startDate) ||
    !isDateKey(schedule.endDate) ||
    schedule.startDate > schedule.endDate ||
    (schedule.kind !== "date" && schedule.kind !== "deadline" && schedule.kind !== "period")
  ) {
    return null;
  }

  return {
    id: schedule.id,
    title: schedule.title,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    time: typeof schedule.time === "string" ? schedule.time : null,
    kind: schedule.kind,
    status: schedule.status === "done" || schedule.status === "cancelled" ? schedule.status : "planned",
    reminderAt: isValidDateTime(schedule.reminderAt) ? schedule.reminderAt : null,
    calendarColor: typeof schedule.calendarColor === "string" ? schedule.calendarColor : undefined,
    linkedTaskId: typeof schedule.linkedTaskId === "string" ? schedule.linkedTaskId : null,
    createdAt: typeof schedule.createdAt === "string" ? schedule.createdAt : "",
    updatedAt: typeof schedule.updatedAt === "string" ? schedule.updatedAt : "",
    memo: typeof schedule.memo === "string" ? schedule.memo : ""
  };
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const normalized = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  return normalized === value;
}

function isValidDateTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}
