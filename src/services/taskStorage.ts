import { mockTasks } from "../features/today/mockTasks";
import type { Task } from "../types/task";

const storageKey = "dont-forget.tasks.v1";

type StoredTasks = {
  version: 1;
  tasks: Task[];
};

export function loadStoredTasks(): Task[] {
  if (!canUseStorage()) return mockTasks;

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return mockTasks;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredTasks>;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return sanitizeTasks(mockTasks);
    return sanitizeTasks(parsed.tasks);
  } catch {
    return sanitizeTasks(mockTasks);
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

function sanitizeTasks(tasks: Task[]) {
  return tasks.map((task) => ({
    ...task,
    reminderAt: null
  }));
}
