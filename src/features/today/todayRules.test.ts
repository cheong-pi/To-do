import { describe, expect, it } from "vitest";
import type { Task, TodaySortGroup } from "../../types/task";
import { sortTodayTasks } from "./todayRules";

describe("sortTodayTasks", () => {
  it("uses the product-defined group order", () => {
    const groups: TodaySortGroup[] = [
      "no_date",
      "started",
      "near_deadline",
      "repeat_today",
      "pulled_to_today",
      "timed_today"
    ];

    const result = sortTodayTasks(groups.map((group, index) => makeTask(String(index), group)));

    expect(result.map((task) => task.todaySortGroup)).toEqual([
      "timed_today",
      "pulled_to_today",
      "repeat_today",
      "near_deadline",
      "started",
      "no_date"
    ]);
  });

  it("sorts every timed task by the 24-hour time regardless of source group", () => {
    const result = sortTodayTasks([
      makeTask("late", "timed_today", "18:00", "2026-06-10"),
      makeTask("early-late-due", "repeat_today", "09:00", "2026-06-20"),
      makeTask("early-near-due", "pulled_to_today", "09:00", "2026-06-12"),
      makeTask("untimed", "timed_today", null, "2026-06-11")
    ]);

    expect(result.map((task) => task.id)).toEqual(["early-near-due", "early-late-due", "late", "untimed"]);
  });

  it("does not mutate the caller's task array", () => {
    const tasks = [makeTask("second", "no_date"), makeTask("first", "timed_today")];
    const originalOrder = tasks.map((task) => task.id);

    sortTodayTasks(tasks);

    expect(tasks.map((task) => task.id)).toEqual(originalOrder);
  });
});

function makeTask(id: string, group: TodaySortGroup, time: string | null = null, dueDate: string | null = null): Task {
  return {
    id,
    title: id,
    date: "2026-06-11",
    dueDate,
    time,
    source: "manual",
    status: "planned",
    priority: "normal",
    todaySortGroup: group,
    postponeCount: 0,
    progressPercent: 0,
    remainingPercent: 100,
    reminderAt: null,
    parentTaskId: null,
    memo: ""
  };
}
