import type { Task, TodaySortGroup } from "../../types/task";

const sortGroupOrder: TodaySortGroup[] = [
  "timed_today",
  "pulled_to_today",
  "repeat_today",
  "near_deadline",
  "started",
  "no_date"
];

export function sortTodayTasks(tasks: Task[]) {
  return [...tasks]
    .sort((a, b) => {
      const aHasTime = Boolean(a.time);
      const bHasTime = Boolean(b.time);
      if (aHasTime && bHasTime) {
        const timeDiff = a.time!.localeCompare(b.time!);
        if (timeDiff !== 0) return timeDiff;
      } else if (aHasTime !== bHasTime) {
        return aHasTime ? -1 : 1;
      }

      const groupDiff = getGroupIndex(a.todaySortGroup) - getGroupIndex(b.todaySortGroup);
      if (groupDiff !== 0) return groupDiff;

      return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    });
}

function getGroupIndex(group: TodaySortGroup | null) {
  if (!group) return sortGroupOrder.length;
  const index = sortGroupOrder.indexOf(group);
  return index === -1 ? sortGroupOrder.length : index;
}
