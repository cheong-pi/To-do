import { describe, expect, it } from "vitest";
import type { Task } from "../../types/task";
import { getTaskReminderDate } from "./reminderRules";

describe("getTaskReminderDate", () => {
  it("only schedules a D-day reminder on the due date", () => {
    const task = makeTask({ dueDate: "2026-06-18", time: "09:00", source: "deadline" });

    expect(getTaskReminderDate(task, "2026-06-17")).toBeNull();
    expect(getTaskReminderDate(task, "2026-06-18")?.getHours()).toBe(9);
  });

  it("keeps ordinary timed tasks scheduled on the selected date", () => {
    const task = makeTask({ time: "14:30" });

    const reminder = getTaskReminderDate(task, "2026-06-15");

    expect(reminder?.getFullYear()).toBe(2026);
    expect(reminder?.getMonth()).toBe(5);
    expect(reminder?.getDate()).toBe(15);
    expect(reminder?.getHours()).toBe(14);
    expect(reminder?.getMinutes()).toBe(30);
  });
});

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task",
    title: "테스트",
    date: "2026-06-15",
    dueDate: null,
    time: null,
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
