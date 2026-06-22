import { Capacitor } from "@capacitor/core";
import {
  LocalNotifications,
  type LocalNotificationSchema,
  type PermissionStatus
} from "@capacitor/local-notifications";
import type { RepeatKind, Schedule, Task } from "../types/task";

type AppLanguage = "ko" | "en";

export type PlanReminder = {
  id: string;
  title: string;
  startTime: string;
};

const channelId = "task-reminders";
const scheduleHorizonDays = 60;
const maxScheduledNotifications = 128;
let notificationSync = Promise.resolve();

export function isNativeNotificationPlatform() {
  return Capacitor.isNativePlatform();
}

export async function getNativeNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNativeNotificationPlatform()) return "unsupported";
  return mapPermission(await LocalNotifications.checkPermissions());
}

export async function requestNativeNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNativeNotificationPlatform()) return "unsupported";
  const permission = await LocalNotifications.requestPermissions();
  if (permission.display === "granted") {
    await ensureAndroidChannel();
    await requestExactAlarmAccess();
  }
  return mapPermission(permission);
}

export async function showNativeTestNotification(language: AppLanguage) {
  if (!isNativeNotificationPlatform()) return;
  await ensureAndroidChannel();
  await LocalNotifications.schedule({
    notifications: [
      {
        id: notificationId(`test-${Date.now()}`),
        title: language === "ko" ? "잊지 마" : "Don't Forget",
        body: language === "ko" ? "네이티브 알림이 정상적으로 동작합니다." : "Native notifications are working.",
        channelId,
        autoCancel: true,
        schedule: { at: new Date(Date.now() + 1000) }
      }
    ]
  });
}

export function syncNativeNotifications(tasks: Task[], schedules: Schedule[], language: AppLanguage, planReminders: PlanReminder[] = []) {
  notificationSync = notificationSync
    .catch(() => undefined)
    .then(() => replaceNativeNotifications(tasks, schedules, language, planReminders));
  return notificationSync;
}

async function replaceNativeNotifications(tasks: Task[], schedules: Schedule[], language: AppLanguage, planReminders: PlanReminder[]) {
  if (!isNativeNotificationPlatform()) return;

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return;

  await ensureAndroidChannel();

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map(({ id }) => ({ id }))
    });
  }

  const notifications = buildNativeNotificationPlan(tasks, schedules, new Date(), language, planReminders);

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications });
  }
}

export function buildNativeNotificationPlan(
  tasks: Task[],
  schedules: Schedule[],
  now: Date,
  language: AppLanguage,
  planReminders: PlanReminder[] = []
) {
  return [
    ...tasks.flatMap((task) => buildTaskNotifications(task, now, language)),
    ...schedules.flatMap((schedule) => buildScheduleNotifications(schedule, now, language)),
    ...planReminders.flatMap((reminder) => buildPlanNotifications(reminder, now, language))
  ]
    .sort((a, b) => (a.schedule?.at?.getTime() ?? 0) - (b.schedule?.at?.getTime() ?? 0))
    .slice(0, maxScheduledNotifications);
}

function buildPlanNotifications(reminder: PlanReminder, now: Date, language: AppLanguage) {
  if (!/^\d{2}:\d{2}$/.test(reminder.startTime)) return [];
  return datesInHorizon(now)
    .slice(0, 30)
    .flatMap((date) => notificationForDate("plan", reminder.id, reminder.title, atTime(dateKey(date), reminder.startTime), now, language));
}

function buildTaskNotifications(task: Task, now: Date, language: AppLanguage): LocalNotificationSchema[] {
  if (task.status === "done" || task.status === "cancelled") return [];

  if (task.reminderAt) {
    return notificationForDate("task", task.id, task.title, new Date(task.reminderAt), now, language);
  }

  if (!task.time) return [];

  if (task.dueDate) {
    return notificationForDate("task", task.id, task.title, atTime(task.dueDate, task.time), now, language);
  }

  const repeatKind = task.repeatKind;
  if (repeatKind && repeatKind !== "none") {
    return datesInHorizon(now)
      .filter((date) => matchesRepeat(repeatKind, task, date))
      .flatMap((date) =>
        notificationForDate("task", task.id, task.title, atTime(dateKey(date), task.time as string), now, language)
      );
  }

  if (task.date) {
    return notificationForDate("task", task.id, task.title, atTime(task.date, task.time), now, language);
  }

  return [];
}

function buildScheduleNotifications(schedule: Schedule, now: Date, language: AppLanguage): LocalNotificationSchema[] {
  if (schedule.status === "done" || schedule.status === "cancelled") return [];

  if (schedule.reminderAt) {
    return notificationForDate("schedule", schedule.id, schedule.title, new Date(schedule.reminderAt), now, language);
  }

  if (!schedule.time) return [];

  if (schedule.kind === "period") {
    return datesInHorizon(now)
      .filter((date) => {
        const key = dateKey(date);
        return key >= schedule.startDate && key <= schedule.endDate;
      })
      .flatMap((date) =>
        notificationForDate(
          "schedule",
          schedule.id,
          schedule.title,
          atTime(dateKey(date), schedule.time as string),
          now,
          language
        )
      );
  }

  return notificationForDate(
    "schedule",
    schedule.id,
    schedule.title,
    atTime(schedule.startDate, schedule.time),
    now,
    language
  );
}

function notificationForDate(
  owner: "task" | "schedule" | "plan",
  ownerId: string,
  title: string,
  at: Date,
  now: Date,
  language: AppLanguage
): LocalNotificationSchema[] {
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return [];

  return [
    {
      id: notificationId(`${owner}:${ownerId}:${at.toISOString()}`),
      title: language === "ko" ? "잊지 마" : "Don't Forget",
      body: title,
      largeBody: title,
      channelId,
      autoCancel: true,
      schedule: {
        at,
        allowWhileIdle: true
      },
      extra: { owner, ownerId }
    }
  ];
}

function datesInHorizon(now: Date) {
  const dates: Date[] = [];
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 0; offset <= scheduleHorizonDays; offset += 1) {
    dates.push(new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset));
  }
  return dates;
}

function matchesRepeat(kind: RepeatKind, task: Task, date: Date) {
  const key = dateKey(date);
  if (task.periodStartDate && key < task.periodStartDate) return false;
  if (task.periodEndDate && key > task.periodEndDate) return false;
  if (kind === "daily" || kind === "date_range") return true;
  if (kind === "weekly") return Boolean(task.repeatDaysOfWeek?.includes(date.getDay()));
  if (kind === "monthly") return task.repeatDayOfMonth === date.getDate();
  return false;
}

function atTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function notificationId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0) || 1;
}

function mapPermission(permission: PermissionStatus): NotificationPermission {
  if (permission.display === "granted") return "granted";
  if (permission.display === "denied") return "denied";
  return "default";
}

async function ensureAndroidChannel() {
  if (Capacitor.getPlatform() !== "android") return;
  await LocalNotifications.createChannel({
    id: channelId,
    name: "할일 및 일정 알림",
    description: "설정한 시간에 할일과 일정을 알려줍니다.",
    importance: 4,
    visibility: 1,
    vibration: true
  });
}

async function requestExactAlarmAccess() {
  if (Capacitor.getPlatform() !== "android") return;
  const setting = await LocalNotifications.checkExactNotificationSetting();
  if (setting.exact_alarm !== "granted") {
    await LocalNotifications.changeExactNotificationSetting();
  }
}
