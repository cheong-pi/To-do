export type TaskStatus = "planned" | "started" | "done" | "postponed" | "cancelled";

export type TaskPriority = "high" | "normal" | "low";

export type TaskSource = "manual" | "routine" | "deadline" | "no_date";

export type RepeatKind = "none" | "daily" | "weekly" | "date_range" | "monthly";

export type TaskKindOption = "no_deadline" | "today" | "dday" | "repeat";

export type TaskOwner = "task" | "schedule";

export type TodaySortGroup =
  | "timed_today"
  | "pulled_to_today"
  | "repeat_today"
  | "near_deadline"
  | "started"
  | "no_date";

export type Task = {
  id: string;
  title: string;
  date: string | null;
  dueDate: string | null;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  time: string | null;
  source: TaskSource;
  status: TaskStatus;
  priority: TaskPriority;
  todaySortGroup: TodaySortGroup | null;
  taskKindOption?: TaskKindOption;
  owner?: TaskOwner;
  postponeCount: number;
  progressPercent: number;
  remainingPercent: number;
  reminderAt: string | null;
  parentTaskId: string | null;
  isFixed?: boolean;
  calendarColor?: string;
  routineId?: string | null;
  routineRuleId?: string | null;
  repeatKind?: RepeatKind;
  repeatDaysOfWeek?: number[];
  repeatDayOfMonth?: number | null;
  completedDates?: string[];
  isGenerated?: boolean;
  isManuallyEdited?: boolean;
  memo: string;
};

export type Routine = {
  id: string;
  title: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoutineRule = {
  id: string;
  routineId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  repeatKind: Exclude<RepeatKind, "none">;
  daysOfWeek: number[];
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  calendarColor: string;
  createdAt: string;
};

export type TaskInstance = Task & {
  routineId: string | null;
  routineRuleId: string | null;
  isGenerated: boolean;
  isManuallyEdited: boolean;
};
