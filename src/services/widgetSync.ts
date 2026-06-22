import { Capacitor, registerPlugin } from "@capacitor/core";

export type WidgetTaskItem = {
  id: string;
  title: string;
  time: string | null;
  done: boolean;
  owner: "task" | "schedule";
  scheduleId: string | null;
  repeat: boolean;
};

export type WidgetAction = {
  id: string;
  date: string;
  done: boolean;
  owner: "task" | "schedule";
  scheduleId: string | null;
  repeat: boolean;
};

type WidgetBridgePlugin = {
  syncWidget(options: { date: string; dateLabel: string; items: WidgetTaskItem[] }): Promise<void>;
  consumeActions(): Promise<{ actions: WidgetAction[] }>;
};

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge");

export function isAndroidWidgetAvailable() {
  return Capacitor.getPlatform() === "android";
}

export async function syncAndroidWidget(date: string, dateLabel: string, items: WidgetTaskItem[]) {
  if (!isAndroidWidgetAvailable()) return;
  await WidgetBridge.syncWidget({ date, dateLabel, items: items.slice(0, 5) });
}

export async function consumeAndroidWidgetActions() {
  if (!isAndroidWidgetAvailable()) return [];
  const result = await WidgetBridge.consumeActions();
  return Array.isArray(result.actions) ? result.actions : [];
}
