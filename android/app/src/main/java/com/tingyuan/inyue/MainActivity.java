package com.tingyuan.inyue;

import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "inyue_appearance";
    private static final String KEY_THEME = "theme";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackProgressPlugin.class);
        registerPlugin(OfflineMediaPlugin.class);
        registerPlugin(NativeThemePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        configureWebView();
        applyTheme();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyTheme();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyTheme();
    }

    void setThemePreference(String theme) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (!theme.equals(prefs.getString(KEY_THEME, "system"))) {
            prefs.edit().putString(KEY_THEME, theme).apply();
        }
        applyTheme();
    }

    private void configureWebView() {
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
    }

    private void applyTheme() {
        String preference = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(KEY_THEME, "system");
        boolean isDark;
        if ("dark".equals(preference)) {
            isDark = true;
        } else if ("light".equals(preference)) {
            isDark = false;
        } else {
            isDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        }

        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!isDark);
        controller.setAppearanceLightNavigationBars(!isDark);

        int background = ContextCompat.getColor(
            this,
            isDark ? R.color.app_background_dark : R.color.app_background_light
        );
        window.setBackgroundDrawable(new ColorDrawable(background));
        window.getDecorView().setBackgroundColor(background);

        Bridge bridge = getBridge();
        if (bridge != null && bridge.getWebView() != null) {
            WebView webView = bridge.getWebView();
            webView.setBackgroundColor(background);
            if (webView.getParent() instanceof View parentView) {
                parentView.setBackgroundColor(background);
            }
        }
    }
}
