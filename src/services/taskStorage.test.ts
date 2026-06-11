import { beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../types/task";
import { loadStoredTasks, saveStoredTasks } from "./taskStorage";

const storageKey = "dont-forget.tasks.v1";

describe("taskStorage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a valid reminder instead of deleting it on reload", () => {
    const task = makeTask({ reminderAt: "2026-06-11T09:10:00+09:00" });

    saveStoredTasks([task]);

    expect(loadStoredTasks()[0].reminderAt).toBe(task.reminderAt);
  });

  it("removes an invalid reminder without discarding the task", () => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      tasks: [{ ...makeTask(), reminderAt: "not-a-date" }]
    }));

    const tasks = loadStoredTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].reminderAt).toBeNull();
  });

  it("fills safe defaults for legacy task fields", () => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      tasks: [{ id: "legacy", title: "예전 할일", date: null, dueDate: null, time: null }]
    }));

    expect(loadStoredTasks()).toEqual([
      expect.objectContaining({
        id: "legacy",
        source: "manual",
        status: "planned",
        priority: "normal",
        progressPercent: 0,
        remainingPercent: 100,
        memo: ""
      })
    ]);
  });

  it("ignores entries that cannot be recovered", () => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      tasks: [null, "bad", { title: "missing id" }, { id: "ok", title: "정상" }]
    }));

    expect(loadStoredTasks().map((task) => task.id)).toEqual(["ok"]);
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "테스트",
    date: "2026-06-11",
    dueDate: null,
    time: "09:00",
    source: "manual",
    status: "planned",
    priority: "normal",
    todaySortGroup: "timed_today",
    postponeCount: 0,
    progressPercent: 0,
    remainingPercent: 100,
    reminderAt: null,
    parentTaskId: null,
    memo: "",
    ...overrides
  };
}
