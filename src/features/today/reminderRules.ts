import type { Task } from "../../types/task";

export function getTaskReminderDate(task: Task, selectedDate: string) {
  if (task.dueDate && selectedDate !== task.dueDate) return null;

  if (task.reminderAt) {
    const reminderDate = new Date(task.reminderAt);
    return Number.isNaN(reminderDate.getTime()) ? null : reminderDate;
  }

  if (!task.time) return null;

  const reminderDate = new Date(`${selectedDate}T${task.time}:00`);
  return Number.isNaN(reminderDate.getTime()) ? null : reminderDate;
}
