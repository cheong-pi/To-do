import { describe, expect, it } from "vitest";
import type { Schedule, Task } from "../types/task";
import { buildNativeNotificationPlan } from "./nativeNotifications";

describe("native notification plan", () => {
  it("schedules a D-day task only on its due date", () => {
    const task = makeTask({
      id: "deadline",
      dueDate: "2026-06-18",
      time: "09:00",
      source: "deadline"
    });

    const plan = buildNativeNotificationPlan([task], [], new Date("2026-06-16T08:00:00"), "ko");

    expect(plan).toHaveLength(1);
    expect(plan[0].schedule?.at).toEqual(new Date("2026-06-18T09:00:00"));
    expect(plan[0].body).toBe("테스트 할일");
  });

  it("schedules a weekly task only on matching weekdays", () => {
    const task = makeTask({
      id: "weekly",
      time: "10:00",
      repeatKind: "weekly",
      repeatDaysOfWeek: [1],
      periodStartDate: "2026-06-15",
      periodEndDate: "2026-06-30"
    });

    const plan = buildNativeNotificationPlan([task], [], new Date("2026-06-16T08:00:00"), "ko");
    const dates = plan.map((notification) => notification.schedule?.at?.getDate());

    expect(dates).toEqual([22, 29]);
  });

  it("schedules each day of a timed period schedule", () => {
    const schedule: Schedule = {
      id: "period",
      title: "기간 일정",
      startDate: "2026-06-17",
      endDate: "2026-06-19",
      time: "12:30",
      kind: "period",
      status: "planned",
      reminderAt: null,
      createdAt: "",
      updatedAt: ""
    };

    const plan = buildNativeNotificationPlan([], [schedule], new Date("2026-06-16T08:00:00"), "ko");

    expect(plan.map((notification) => notification.schedule?.at?.getDate())).toEqual([17, 18, 19]);
  });
});

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task",
    title: "테스트 할일",
    date: null,
    dueDate: null,
    periodStartDate: null,
    periodEndDate: null,
    time: null,
    source: "manual",
    status: "planned",
    priority: "normal",
    todaySortGroup: null,
    postponeCount: 0,
    progressPercent: 0,
    remainingPercent: 100,
    reminderAt: null,
    parentTaskId: null,
    repeatKind: "none",
    repeatDaysOfWeek: [],
    repeatDayOfMonth: null,
    completedDates: [],
    memo: "",
    ...overrides
  };
}
