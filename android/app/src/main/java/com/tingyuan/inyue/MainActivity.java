package com.tingyuan.inyue;

import android.content.ComponentCallbacks2;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
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
    private static final long REVEAL_TIMEOUT_MS = 600L;
    private static final long REVEAL_MIN_SETTLE_MS = 32L;
    private static final long RECENT_SNAPSHOT_MS = 400L;
    private static final long SOLID_FALLBACK_FADE_MS = 80L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ImageView resumeSnapshotView;
    private Bitmap resumeSnapshotBitmap;
    private int snapshotSourceWidth;
    private int snapshotSourceHeight;
    private long lastSnapshotUptimeMs;
    private boolean captureInFlight;
    private boolean isSolidFallbackOverlay;
    private boolean isPaused;
    private boolean isStopped;
    private boolean hasWindowFocus = true;
    private boolean leavingHintActive;
    private long captureGeneration;
    private long revealGeneration;
    private Runnable revealTimeoutRunnable;
    private Runnable revealPendingRunnable;
    private Runnable pendingFrameCommitCallback;
    private Boolean appliedIsDark;
    private Integer appliedBackgroundColor;
    private int currentBackgroundColor;
    private int lastOrientation;
    private int lastScreenWidthDp;
    private int lastScreenHeightDp;
    private int lastDensityDpi;
    private int lastUiModeNight;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackProgressPlugin.class);
        registerPlugin(OfflineMediaPlugin.class);
        registerPlugin(NativeThemePlugin.class);
        super.onCreate(savedInstanceState);
        recordConfiguration(getResources().getConfiguration());
        configureWebView();
        applyTheme(true);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        hasWindowFocus = hasFocus;
        if (!hasFocus) {
            if (!isPaused && !isStopped && !isResumeSnapshotVisible()) {
                captureResumeSnapshot();
            }
            return;
        }
        leavingHintActive = false;
        if (!isPaused && !isStopped && !isResumeSnapshotVisible()) {
            discardUnusedSnapshot();
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        leavingHintActive = true;
        if (!isResumeSnapshotVisible()) {
            captureResumeSnapshot();
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        if (isStopped) {
            showResumeSnapshot(true);
        }
    }

    @Override
    public void onResume() {
        boolean returningFromStop = isStopped;
        isPaused = false;
        isStopped = false;
        leavingHintActive = false;
        captureGeneration++;
        captureInFlight = false;
        super.onResume();
        applyTheme(false);
        if (returningFromStop) {
            if (!isResumeSnapshotVisible()) {
                showResumeSnapshot(true);
            }
            if (isResumeSnapshotVisible()) {
                scheduleResumeSnapshotReveal();
            } else {
                clearResumeSnapshot();
            }
        } else {
            clearResumeSnapshot();
        }
    }

    @Override
    public void onPause() {
        isPaused = true;
        cancelPendingReveal();
        if (isResumeSnapshotVisible() && resumeSnapshotView != null) {
            resumeSnapshotView.animate().cancel();
            resumeSnapshotView.setAlpha(1f);
        }
        captureResumeSnapshot();
        super.onPause();
    }

    @Override
    public void onStop() {
        isStopped = true;
        leavingHintActive = false;
        showResumeSnapshot(false);
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
        boolean geometryChanged = newConfig.orientation != lastOrientation
            || newConfig.screenWidthDp != lastScreenWidthDp
            || newConfig.screenHeightDp != lastScreenHeightDp
            || newConfig.densityDpi != lastDensityDpi;
        int nextUiModeNight = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean nightModeChanged = nextUiModeNight != lastUiModeNight
            && "system".equals(getThemePreference());
        recordConfiguration(newConfig);

        // SystemBars resets DecorView background and bar appearance on configuration changes.
        applyTheme(true);
        if (geometryChanged || nightModeChanged) {
            invalidateSnapshotBitmap();
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE && (isStopped || !isResumeSnapshotVisible())) {
            downscaleResumeSnapshot();
        }
    }

    void setThemePreference(String theme) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (!theme.equals(prefs.getString(KEY_THEME, "system"))) {
            prefs.edit().putString(KEY_THEME, theme).apply();
        }
        Integer previousBackground = appliedBackgroundColor;
        applyTheme(false);
        if (previousBackground != null && !previousBackground.equals(appliedBackgroundColor)) {
            invalidateSnapshotBitmap();
        }
    }

    private void recordConfiguration(Configuration config) {
        lastOrientation = config.orientation;
        lastScreenWidthDp = config.screenWidthDp;
        lastScreenHeightDp = config.screenHeightDp;
        lastDensityDpi = config.densityDpi;
        lastUiModeNight = config.uiMode & Configuration.UI_MODE_NIGHT_MASK;
    }

    private String getThemePreference() {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(KEY_THEME, "system");
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Keep the renderer bound to the app process instead of waiving it immediately in background.
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_BOUND, false);
        }
        webView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (!isResumeSnapshotVisible() || !hasValidSnapshotBitmap()) {
                return;
            }
            int width = right - left;
            int height = bottom - top;
            if (width <= 0 || height <= 0) {
                return;
            }
            if (Math.abs(width - snapshotSourceWidth) > 2) {
                invalidateSnapshotBitmap();
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

    private void applyTheme(boolean force) {
        String preference = getThemePreference();
        boolean isDark;
        if ("dark".equals(preference)) {
            isDark = true;
        } else if ("light".equals(preference)) {
            isDark = false;
        } else {
            isDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        }

        int background = ContextCompat.getColor(
            this,
            isDark ? R.color.app_background_dark : R.color.app_background_light
        );
        currentBackgroundColor = background;
        if (!force
            && appliedIsDark != null
            && appliedIsDark == isDark
            && appliedBackgroundColor != null
            && appliedBackgroundColor == background) {
            return;
        }
        appliedIsDark = isDark;
        appliedBackgroundColor = background;

        Window window = getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!isDark);
        controller.setAppearanceLightNavigationBars(!isDark);

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
        if (resumeSnapshotView != null) {
            resumeSnapshotView.setBackgroundColor(background);
        }
    }

    private void captureResumeSnapshot() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        // Never capture over an active overlay (bitmap or solid fallback).
        if (isResumeSnapshotVisible() || captureInFlight) {
            return;
        }
        if (hasValidSnapshotBitmap()
            && (SystemClock.uptimeMillis() - lastSnapshotUptimeMs) < RECENT_SNAPSHOT_MS) {
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

        captureInFlight = true;
        final long generation = ++captureGeneration;
        Rect srcRect = new Rect(left, top, right, bottom);
        try {
            PixelCopy.request(window, srcRect, bitmap, copyResult -> {
                if (generation == captureGeneration) {
                    captureInFlight = false;
                }
                boolean stillLeavingOrBackground = isPaused || isStopped || !hasWindowFocus || leavingHintActive;
                if (copyResult != PixelCopy.SUCCESS
                    || generation != captureGeneration
                    || !stillLeavingOrBackground
                    || isFinishing()
                    || isDestroyed()) {
                    bitmap.recycle();
                    return;
                }
                replaceResumeSnapshotBitmap(bitmap, width, height, SystemClock.uptimeMillis());
                if (isStopped) {
                    showResumeSnapshot(false);
                }
            }, mainHandler);
        } catch (IllegalArgumentException | IllegalStateException ignored) {
            captureInFlight = false;
            bitmap.recycle();
        }
    }

    private void showResumeSnapshot(boolean allowSolidFallback) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        boolean bitmapUsable = hasValidSnapshotBitmap()
            && (webView.getWidth() <= 0 || Math.abs(webView.getWidth() - snapshotSourceWidth) <= 2);
        if (!bitmapUsable) {
            if (hasValidSnapshotBitmap()) {
                releaseSnapshotBitmap(isStopped || !isResumeSnapshotVisible());
            }
            if (!allowSolidFallback) {
                return;
            }
        }
        ImageView overlay = ensureResumeSnapshotView(webView);
        if (overlay == null) {
            return;
        }
        overlay.animate().cancel();
        overlay.setAlpha(1f);
        overlay.setBackgroundColor(currentBackgroundColor);
        if (bitmapUsable) {
            applySnapshotMatrix(overlay, resumeSnapshotBitmap);
            overlay.setImageBitmap(resumeSnapshotBitmap);
            isSolidFallbackOverlay = false;
        } else {
            overlay.setImageDrawable(null);
            isSolidFallbackOverlay = true;
        }
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
        cancelRevealCallbacks();

        revealTimeoutRunnable = () -> {
            if (generation == revealGeneration) {
                finishResumeSnapshotReveal(generation);
            }
        };
        mainHandler.postDelayed(revealTimeoutRunnable, REVEAL_TIMEOUT_MS);

        // Wait one animation frame so ViewRootImpl recreates the foreground Surface
        // and dispatches visibility to WebView before starting the visual state barrier.
        webView.postOnAnimation(() -> {
            if (isRevealStale(generation)) {
                return;
            }
            if (hasValidSnapshotBitmap()
                && webView.getWidth() > 0
                && Math.abs(webView.getWidth() - snapshotSourceWidth) > 2) {
                invalidateSnapshotBitmap();
            }
            webView.invalidate();
            webView.postVisualStateCallback(generation, new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    if (requestId != revealGeneration || isRevealStale(generation)) {
                        return;
                    }
                    final long visualCompleteAt = SystemClock.uptimeMillis();
                    // Force a real RenderThread draw of WebView while the overlay still covers it.
                    webView.invalidate();
                    awaitRenderedFrameCommit(webView, generation, () -> {
                        if (isRevealStale(generation)) {
                            return;
                        }
                        Runnable commitFinalFrame = () -> {
                            revealPendingRunnable = null;
                            if (isRevealStale(generation)) {
                                return;
                            }
                            webView.invalidate();
                            awaitRenderedFrameCommit(webView, generation, () -> {
                                if (!isRevealStale(generation)) {
                                    finishResumeSnapshotReveal(generation);
                                }
                            });
                        };
                        long remainingMs = REVEAL_MIN_SETTLE_MS - (SystemClock.uptimeMillis() - visualCompleteAt);
                        if (remainingMs > 0L) {
                            revealPendingRunnable = commitFinalFrame;
                            mainHandler.postDelayed(commitFinalFrame, remainingMs);
                        } else {
                            commitFinalFrame.run();
                        }
                    });
                }
            });
        });
    }

    private void awaitRenderedFrameCommit(WebView webView, long generation, Runnable onCommitted) {
        clearPendingFrameCommitCallback();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && webView.isHardwareAccelerated()) {
            ViewTreeObserver observer = webView.getViewTreeObserver();
            if (observer.isAlive()) {
                Runnable callback = () -> {
                    pendingFrameCommitCallback = null;
                    if (!isRevealStale(generation)) {
                        onCommitted.run();
                    }
                };
                pendingFrameCommitCallback = callback;
                observer.registerFrameCommitCallback(callback);
                return;
            }
        }
        webView.postOnAnimation(() -> {
            if (!isRevealStale(generation)) {
                onCommitted.run();
            }
        });
    }

    private void finishResumeSnapshotReveal(long generation) {
        if (generation != revealGeneration) {
            return;
        }
        cancelRevealCallbacks();
        if (isSolidFallbackOverlay && resumeSnapshotView != null && isResumeSnapshotVisible()) {
            resumeSnapshotView
                .animate()
                .alpha(0f)
                .setDuration(SOLID_FALLBACK_FADE_MS)
                .withEndAction(() -> {
                    if (generation == revealGeneration && !isPaused && !isStopped) {
                        clearResumeSnapshot();
                    }
                })
                .start();
            return;
        }
        clearResumeSnapshot();
    }

    private boolean isRevealStale(long generation) {
        return generation != revealGeneration || isPaused || isStopped || isFinishing() || isDestroyed();
    }

    private ImageView ensureResumeSnapshotView(WebView webView) {
        if (resumeSnapshotView != null) {
            return resumeSnapshotView;
        }
        if (!(webView.getParent() instanceof ViewGroup parent)) {
            return null;
        }
        ImageView view = new ImageView(this);
        view.setScaleType(ImageView.ScaleType.MATRIX);
        view.setBackgroundColor(currentBackgroundColor);
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

    private void applySnapshotMatrix(ImageView overlay, Bitmap bitmap) {
        Matrix matrix = new Matrix();
        if (snapshotSourceWidth > 0
            && snapshotSourceHeight > 0
            && bitmap.getWidth() > 0
            && bitmap.getHeight() > 0) {
            float scaleX = (float) snapshotSourceWidth / bitmap.getWidth();
            float scaleY = (float) snapshotSourceHeight / bitmap.getHeight();
            matrix.setScale(scaleX, scaleY);
        }
        overlay.setImageMatrix(matrix);
    }

    private boolean hasValidSnapshotBitmap() {
        return resumeSnapshotBitmap != null && !resumeSnapshotBitmap.isRecycled();
    }

    private boolean isResumeSnapshotVisible() {
        return resumeSnapshotView != null && resumeSnapshotView.getVisibility() == View.VISIBLE;
    }

    private void replaceResumeSnapshotBitmap(
        Bitmap nextBitmap,
        int sourceWidth,
        int sourceHeight,
        long capturedAtUptimeMs
    ) {
        Bitmap previous = resumeSnapshotBitmap;
        resumeSnapshotBitmap = nextBitmap;
        snapshotSourceWidth = sourceWidth;
        snapshotSourceHeight = sourceHeight;
        lastSnapshotUptimeMs = capturedAtUptimeMs;
        if (resumeSnapshotView != null && isResumeSnapshotVisible()) {
            applySnapshotMatrix(resumeSnapshotView, nextBitmap);
            resumeSnapshotView.setImageBitmap(nextBitmap);
            isSolidFallbackOverlay = false;
        }
        if (previous != null && previous != nextBitmap && !previous.isRecycled()) {
            if (isStopped || !isResumeSnapshotVisible()) {
                previous.recycle();
            }
        }
    }

    private void downscaleResumeSnapshot() {
        if (!hasValidSnapshotBitmap() || snapshotSourceWidth <= 0 || snapshotSourceHeight <= 0) {
            return;
        }
        int targetWidth = Math.max(1, snapshotSourceWidth / 2);
        int targetHeight = Math.max(1, snapshotSourceHeight / 2);
        if (resumeSnapshotBitmap.getWidth() <= targetWidth
            && resumeSnapshotBitmap.getHeight() <= targetHeight) {
            return;
        }
        try {
            Bitmap scaled = Bitmap.createScaledBitmap(resumeSnapshotBitmap, targetWidth, targetHeight, true);
            if (scaled != resumeSnapshotBitmap) {
                replaceResumeSnapshotBitmap(scaled, snapshotSourceWidth, snapshotSourceHeight, lastSnapshotUptimeMs);
            }
        } catch (OutOfMemoryError ignored) {
            invalidateSnapshotBitmap();
        }
    }

    private void invalidateSnapshotBitmap() {
        captureGeneration++;
        captureInFlight = false;
        boolean wasVisible = isResumeSnapshotVisible();
        if (resumeSnapshotView != null && wasVisible) {
            resumeSnapshotView.setImageDrawable(null);
            resumeSnapshotView.setBackgroundColor(currentBackgroundColor);
            isSolidFallbackOverlay = true;
        }
        releaseSnapshotBitmap(isStopped || !wasVisible);
    }

    private void discardUnusedSnapshot() {
        captureGeneration++;
        captureInFlight = false;
        releaseSnapshotBitmap(true);
    }

    private void releaseSnapshotBitmap(boolean safeToRecycleNow) {
        if (resumeSnapshotBitmap != null) {
            if (safeToRecycleNow && !resumeSnapshotBitmap.isRecycled()) {
                resumeSnapshotBitmap.recycle();
            }
            resumeSnapshotBitmap = null;
        }
        snapshotSourceWidth = 0;
        snapshotSourceHeight = 0;
        lastSnapshotUptimeMs = 0L;
    }

    private void cancelPendingReveal() {
        revealGeneration++;
        cancelRevealCallbacks();
    }

    private void cancelRevealCallbacks() {
        if (revealTimeoutRunnable != null) {
            mainHandler.removeCallbacks(revealTimeoutRunnable);
            revealTimeoutRunnable = null;
        }
        if (revealPendingRunnable != null) {
            mainHandler.removeCallbacks(revealPendingRunnable);
            revealPendingRunnable = null;
        }
        clearPendingFrameCommitCallback();
    }

    private void clearPendingFrameCommitCallback() {
        if (pendingFrameCommitCallback == null) {
            return;
        }
        Runnable callback = pendingFrameCommitCallback;
        pendingFrameCommitCallback = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Bridge bridge = getBridge();
            WebView webView = bridge != null ? bridge.getWebView() : null;
            if (webView != null) {
                ViewTreeObserver observer = webView.getViewTreeObserver();
                if (observer.isAlive()) {
                    observer.unregisterFrameCommitCallback(callback);
                }
            }
        }
    }

    private void clearResumeSnapshot() {
        cancelPendingReveal();
        boolean wasVisible = isResumeSnapshotVisible();
        isSolidFallbackOverlay = false;
        if (resumeSnapshotView != null) {
            resumeSnapshotView.animate().cancel();
            resumeSnapshotView.setAlpha(1f);
            resumeSnapshotView.setVisibility(View.GONE);
            resumeSnapshotView.setImageDrawable(null);
        }
        releaseSnapshotBitmap(isStopped || !wasVisible || isDestroyed());
    }
}
