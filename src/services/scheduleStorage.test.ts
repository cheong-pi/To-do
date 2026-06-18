import { beforeEach, describe, expect, it } from "vitest";
import type { Schedule } from "../types/task";
import { loadStoredSchedules, saveStoredSchedules } from "./scheduleStorage";

const storageKey = "dont-forget.schedules.v1";

describe("scheduleStorage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips valid schedules and reminders", () => {
    const schedule = makeSchedule();

    saveStoredSchedules([schedule]);

    expect(loadStoredSchedules()).toEqual([schedule]);
  });

  it("fills optional defaults in older schedules", () => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      schedules: [{
        id: "legacy",
        title: "예전 일정",
        startDate: "2026-06-11",
        endDate: "2026-06-11",
        kind: "date"
      }]
    }));

    expect(loadStoredSchedules()).toEqual([
      expect.objectContaining({
        id: "legacy",
        time: null,
        status: "planned",
        reminderAt: null,
        progressPercent: 0,
        remainingPercent: 100,
        memo: ""
      })
    ]);
  });

  it("rejects impossible or reversed date ranges", () => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      schedules: [
        { ...makeSchedule(), id: "impossible", startDate: "2026-02-31" },
        { ...makeSchedule(), id: "reversed", startDate: "2026-06-12", endDate: "2026-06-11" },
        makeSchedule({ id: "valid" })
      ]
    }));

    expect(loadStoredSchedules().map((schedule) => schedule.id)).toEqual(["valid"]);
  });
});

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "schedule-1",
    title: "테스트 일정",
    startDate: "2026-06-11",
    endDate: "2026-06-12",
    time: "14:00",
    kind: "period",
    status: "planned",
    progressPercent: 0,
    remainingPercent: 100,
    reminderAt: "2026-06-11T14:00:00+09:00",
    linkedTaskId: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    memo: "",
    ...overrides
  };
}
