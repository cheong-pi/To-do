package com.dontforget.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class TodayTasksWidgetProvider extends AppWidgetProvider {
    public static final String PREFS_NAME = "dont_forget_widget";
    public static final String KEY_SNAPSHOT = "snapshot";
    public static final String KEY_ACTIONS = "actions";
    private static final String ACTION_TOGGLE = "com.dontforget.app.WIDGET_TOGGLE";
    private static final int MAX_ITEMS = 5;

    private static final int[] ROW_IDS = {
        R.id.widget_row_1, R.id.widget_row_2, R.id.widget_row_3, R.id.widget_row_4, R.id.widget_row_5
    };
    private static final int[] CHECK_IDS = {
        R.id.widget_check_1, R.id.widget_check_2, R.id.widget_check_3, R.id.widget_check_4, R.id.widget_check_5
    };
    private static final int[] TITLE_IDS = {
        R.id.widget_title_1, R.id.widget_title_2, R.id.widget_title_3, R.id.widget_title_4, R.id.widget_title_5
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        updateWidgets(context, appWidgetManager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_TOGGLE.equals(intent.getAction())) return;

        String itemId = intent.getStringExtra("itemId");
        if (itemId == null) return;
        toggleItem(context, itemId);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TodayTasksWidgetProvider.class));
        updateWidgets(context, manager, ids);
    }

    public static void updateWidgets(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            manager.updateAppWidget(widgetId, buildViews(context));
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today_tasks);
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String rawSnapshot = preferences.getString(KEY_SNAPSHOT, "");
        JSONObject snapshot = null;
        try {
            if (!rawSnapshot.isEmpty()) snapshot = new JSONObject(rawSnapshot);
        } catch (Exception ignored) {
        }

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openApp = PendingIntent.getActivity(
            context,
            9000,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_header, openApp);
        views.setOnClickPendingIntent(R.id.widget_add, openApp);

        for (int rowId : ROW_IDS) views.setViewVisibility(rowId, View.GONE);

        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        if (snapshot == null || !today.equals(snapshot.optString("date"))) {
            views.setTextViewText(R.id.widget_date, context.getString(R.string.widget_today));
            views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_open_to_refresh));
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            return views;
        }

        views.setTextViewText(R.id.widget_date, snapshot.optString("dateLabel", context.getString(R.string.widget_today)));
        JSONArray items = snapshot.optJSONArray("items");
        int count = items == null ? 0 : Math.min(items.length(), MAX_ITEMS);
        views.setViewVisibility(R.id.widget_empty, count == 0 ? View.VISIBLE : View.GONE);
        if (count == 0) views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_empty));

        for (int index = 0; index < count; index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            String itemId = item.optString("id");
            boolean done = item.optBoolean("done", false);
            String time = item.optString("time", "");
            String title = item.optString("title", "");
            String label = time.isEmpty() ? title : time + "  " + title;

            views.setViewVisibility(ROW_IDS[index], View.VISIBLE);
            views.setImageViewResource(CHECK_IDS[index], done ? R.drawable.widget_check_on : R.drawable.widget_check_off);
            views.setTextViewText(TITLE_IDS[index], label);
            views.setTextColor(TITLE_IDS[index], context.getColor(done ? R.color.widget_done_text : R.color.widget_text));

            Intent toggleIntent = new Intent(context, TodayTasksWidgetProvider.class);
            toggleIntent.setAction(ACTION_TOGGLE);
            toggleIntent.putExtra("itemId", itemId);
            PendingIntent togglePendingIntent = PendingIntent.getBroadcast(
                context,
                1000 + Math.abs(itemId.hashCode()),
                toggleIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(CHECK_IDS[index], togglePendingIntent);
            views.setOnClickPendingIntent(TITLE_IDS[index], openApp);
        }
        return views;
    }

    private static void toggleItem(Context context, String itemId) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        try {
            JSONObject snapshot = new JSONObject(preferences.getString(KEY_SNAPSHOT, "{}"));
            JSONArray items = snapshot.optJSONArray("items");
            if (items == null) return;

            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.optJSONObject(index);
                if (item == null || !itemId.equals(item.optString("id"))) continue;
                boolean done = !item.optBoolean("done", false);
                item.put("done", done);

                JSONArray actions = new JSONArray(preferences.getString(KEY_ACTIONS, "[]"));
                JSONObject action = new JSONObject();
                action.put("id", itemId);
                action.put("date", snapshot.optString("date"));
                action.put("done", done);
                action.put("owner", item.optString("owner", "task"));
                action.put("scheduleId", item.opt("scheduleId"));
                action.put("repeat", item.optBoolean("repeat", false));
                actions.put(action);

                preferences.edit()
                    .putString(KEY_SNAPSHOT, snapshot.toString())
                    .putString(KEY_ACTIONS, actions.toString())
                    .apply();
                return;
            }
        } catch (Exception ignored) {
        }
    }
}
