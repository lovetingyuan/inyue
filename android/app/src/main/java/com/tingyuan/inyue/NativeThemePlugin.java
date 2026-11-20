package com.tingyuan.inyue;

import android.app.Activity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeTheme")
public class NativeThemePlugin extends Plugin {
    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = call.getString("theme", "system");
        if (!"system".equals(theme) && !"light".equals(theme) && !"dark".equals(theme)) {
            call.reject("Invalid theme");
            return;
        }
        Activity activity = getActivity();
        if (activity instanceof MainActivity mainActivity) {
            activity.runOnUiThread(() -> {
                mainActivity.setThemePreference(theme);
                call.resolve();
            });
            return;
        }
        call.resolve();
    }
}
