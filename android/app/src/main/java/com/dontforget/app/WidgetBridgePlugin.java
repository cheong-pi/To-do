package com.dontforget.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    @PluginMethod
    public void syncWidget(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(TodayTasksWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit().putString(TodayTasksWidgetProvider.KEY_SNAPSHOT, call.getData().toString()).apply();
        AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
        int[] ids = manager.getAppWidgetIds(new ComponentName(getContext(), TodayTasksWidgetProvider.class));
        TodayTasksWidgetProvider.updateWidgets(getContext(), manager, ids);
        call.resolve();
    }

    @PluginMethod
    public void consumeActions(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(TodayTasksWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        String rawActions = preferences.getString(TodayTasksWidgetProvider.KEY_ACTIONS, "[]");
        preferences.edit().putString(TodayTasksWidgetProvider.KEY_ACTIONS, "[]").apply();

        JSObject result = new JSObject();
        try {
            result.put("actions", new JSArray(new JSONArray(rawActions)));
        } catch (Exception error) {
            result.put("actions", new JSArray());
        }
        call.resolve(result);
    }
}
