package com.tingyuan.inyue;

import android.content.ComponentCallbacks2;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.ImageView;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "inyue_appearance";
    private static final String KEY_THEME = "theme";
    private static final long REVEAL_TIMEOUT_MS = 450L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ImageView resumeSnapshotView;
    private Bitmap resumeSnapshotBitmap;
    private boolean isPaused;
    private boolean isStopped;
    private long captureGeneration;
    private long revealGeneration;
    private Runnable revealTimeoutRunnable;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackProgressPlugin.class);
        registerPlugin(OfflineMediaPlugin.class);
        registerPlugin(NativeThemePlugin.class);
        super.onCreate(savedInstanceState);
        configureWebView();
        applyTheme();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (isStopped) {
            showResumeSnapshot();
        }
    }

    @Override
    public void onResume() {
        boolean returningFromStop = isStopped;
        isPaused = false;
        isStopped = false;
        captureGeneration++;
        super.onResume();
        applyTheme();
        if (returningFromStop && isResumeSnapshotVisible()) {
            scheduleResumeSnapshotReveal();
        } else {
            clearResumeSnapshot();
        }
    }

    @Override
    public void onPause() {
        isPaused = true;
        cancelPendingReveal();
        captureResumeSnapshot();
        super.onPause();
    }

    @Override
    public void onStop() {
        isStopped = true;
        showResumeSnapshot();
        super.onStop();
    }

    @Override
    public void onDestroy() {
        clearResumeSnapshot();
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        clearResumeSnapshot();
        applyTheme();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level > ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) {
            clearResumeSnapshot();
        }
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Keep the renderer bound to the app process instead of waiving it immediately in background.
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_BOUND, false);
        }
        webView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (!isResumeSnapshotVisible() || resumeSnapshotBitmap == null || resumeSnapshotBitmap.isRecycled()) {
                return;
            }
            int width = right - left;
            int height = bottom - top;
            if (width != resumeSnapshotBitmap.getWidth() || height != resumeSnapshotBitmap.getHeight()) {
                clearResumeSnapshot();
            }
        });
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                mainHandler.post(() -> {
                    clearResumeSnapshot();
                    if (!isFinishing() && !isDestroyed()) {
                        recreate();
                    }
                });
                return true;
            }
        });
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

    private void captureResumeSnapshot() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        // Keep the existing snapshot if the user leaves before the previous resume finishes revealing.
        if (isResumeSnapshotVisible() && resumeSnapshotBitmap != null && !resumeSnapshotBitmap.isRecycled()) {
            return;
        }
        Bridge bridge = getBridge();
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null
            || !webView.isAttachedToWindow()
            || webView.getVisibility() != View.VISIBLE
            || webView.getProgress() < 100) {
            return;
        }
        int width = webView.getWidth();
        int height = webView.getHeight();
        Window window = getWindow();
        if (width <= 0 || height <= 0 || window == null) {
            return;
        }
        View decorView = window.peekDecorView();
        if (decorView == null || decorView.getWidth() <= 0 || decorView.getHeight() <= 0) {
            return;
        }

        int[] location = new int[2];
        webView.getLocationInWindow(location);
        int left = Math.max(0, location[0]);
        int top = Math.max(0, location[1]);
        int right = Math.min(decorView.getWidth(), location[0] + width);
        int bottom = Math.min(decorView.getHeight(), location[1] + height);
        if (right - left != width || bottom - top != height) {
            return;
        }

        final Bitmap bitmap;
        try {
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        } catch (OutOfMemoryError ignored) {
            return;
        }

        final long generation = ++captureGeneration;
        Rect srcRect = new Rect(left, top, right, bottom);
        try {
            PixelCopy.request(window, srcRect, bitmap, copyResult -> {
                if (copyResult != PixelCopy.SUCCESS
                    || generation != captureGeneration
                    || !isPaused
                    || isFinishing()
                    || isDestroyed()) {
                    bitmap.recycle();
                    return;
                }
                replaceResumeSnapshotBitmap(bitmap);
                if (isStopped) {
                    showResumeSnapshot();
                }
            }, mainHandler);
        } catch (IllegalArgumentException | IllegalStateException ignored) {
            bitmap.recycle();
        }
    }

    private void showResumeSnapshot() {
        if (resumeSnapshotBitmap == null || resumeSnapshotBitmap.isRecycled()) {
            return;
        }
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView.getWidth() > 0
            && webView.getHeight() > 0
            && (webView.getWidth() != resumeSnapshotBitmap.getWidth()
                || webView.getHeight() != resumeSnapshotBitmap.getHeight())) {
            clearResumeSnapshot();
            return;
        }
        ImageView overlay = ensureResumeSnapshotView(webView);
        if (overlay == null) {
            return;
        }
        overlay.setImageBitmap(resumeSnapshotBitmap);
        overlay.setVisibility(View.VISIBLE);
        overlay.bringToFront();
    }

    private void scheduleResumeSnapshotReveal() {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            clearResumeSnapshot();
            return;
        }
        WebView webView = bridge.getWebView();
        final long generation = ++revealGeneration;
        cancelRevealTimeout();

        revealTimeoutRunnable = () -> {
            if (generation == revealGeneration) {
                clearResumeSnapshot();
            }
        };
        mainHandler.postDelayed(revealTimeoutRunnable, REVEAL_TIMEOUT_MS);

        webView.post(() -> {
            if (generation != revealGeneration || isPaused || isFinishing() || isDestroyed()) {
                return;
            }
            if (resumeSnapshotBitmap == null
                || resumeSnapshotBitmap.isRecycled()
                || (webView.getWidth() > 0
                    && webView.getHeight() > 0
                    && (webView.getWidth() != resumeSnapshotBitmap.getWidth()
                        || webView.getHeight() != resumeSnapshotBitmap.getHeight()))) {
                clearResumeSnapshot();
                return;
            }
            webView.invalidate();
            webView.postVisualStateCallback(generation, new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    if (requestId != revealGeneration || isPaused || isFinishing() || isDestroyed()) {
                        return;
                    }
                    // Wait for Android's RenderThread to draw and present the newly committed WebView frame.
                    webView.postOnAnimation(() -> {
                        if (generation != revealGeneration || isPaused || isFinishing() || isDestroyed()) {
                            return;
                        }
                        webView.postOnAnimation(() -> {
                            if (generation == revealGeneration && !isPaused) {
                                clearResumeSnapshot();
                            }
                        });
                    });
                }
            });
        });
    }

    private ImageView ensureResumeSnapshotView(WebView webView) {
        if (resumeSnapshotView != null) {
            return resumeSnapshotView;
        }
        if (!(webView.getParent() instanceof ViewGroup parent)) {
            return null;
        }
        ImageView view = new ImageView(this);
        view.setScaleType(ImageView.ScaleType.FIT_XY);
        view.setClickable(false);
        view.setFocusable(false);
        view.setEnabled(false);
        view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        view.setVisibility(View.GONE);
        parent.addView(
            view,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        resumeSnapshotView = view;
        return view;
    }

    private boolean isResumeSnapshotVisible() {
        return resumeSnapshotView != null && resumeSnapshotView.getVisibility() == View.VISIBLE;
    }

    private void replaceResumeSnapshotBitmap(Bitmap nextBitmap) {
        Bitmap previous = resumeSnapshotBitmap;
        resumeSnapshotBitmap = nextBitmap;
        if (resumeSnapshotView != null && isResumeSnapshotVisible()) {
            resumeSnapshotView.setImageBitmap(nextBitmap);
        }
        if (previous != null && previous != nextBitmap && !previous.isRecycled()) {
            previous.recycle();
        }
    }

    private void cancelPendingReveal() {
        revealGeneration++;
        cancelRevealTimeout();
    }

    private void cancelRevealTimeout() {
        if (revealTimeoutRunnable != null) {
            mainHandler.removeCallbacks(revealTimeoutRunnable);
            revealTimeoutRunnable = null;
        }
    }

    private void clearResumeSnapshot() {
        cancelPendingReveal();
        if (resumeSnapshotView != null) {
            resumeSnapshotView.setVisibility(View.GONE);
            resumeSnapshotView.setImageDrawable(null);
        }
        if (resumeSnapshotBitmap != null) {
            if (!resumeSnapshotBitmap.isRecycled()) {
                resumeSnapshotBitmap.recycle();
            }
            resumeSnapshotBitmap = null;
        }
    }
}
