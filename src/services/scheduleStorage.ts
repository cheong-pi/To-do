import type { Schedule } from "../types/task";

const storageKey = "dont-forget.schedules.v1";

type StoredSchedules = {
  version: 1;
  schedules: Schedule[];
};

export function loadStoredSchedules(): Schedule[] {
  if (!canUseStorage()) return [];

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSchedules>;
    if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) return [];
    return parsed.schedules.filter(isSchedule);
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
