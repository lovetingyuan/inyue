package com.tingyuan.inyue;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "AppUpdate",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class AppUpdatePlugin extends Plugin {
    private static final String CHANNEL_ID = "inyue_app_update";
    private static final String CHANNEL_NAME = "应用更新";
    private static final int NOTIFICATION_ID = 4001;
    private static final int MAX_REDIRECTS = 6;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final long MAX_APK_BYTES = 256L * 1024L * 1024L;
    private static final long NOTIFICATION_THROTTLE_MS = 300L;
    private static final String ALLOWED_HOST = "github.com";
    private static final String ALLOWED_PATH_PREFIX = "/lovetingyuan/inyue/releases/download/";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private volatile HttpURLConnection activeConnection;
    private volatile boolean notificationPermissionRequested = false;
    private volatile boolean waitingForInstallPermission = false;
    private volatile File downloadedApkFile;
    private volatile String activeUrl = "";
    private volatile String currentStatus = "idle";
    private volatile String currentVersion = "";
    private volatile long currentDownloadedBytes = 0L;
    private volatile long currentTotalBytes = -1L;
    private volatile int currentPercent = -1;
    private volatile String currentMessage = "";

    @Override
    protected void handleOnResume() {
        if (!waitingForInstallPermission) {
            return;
        }
        waitingForInstallPermission = false;
        File apkFile = downloadedApkFile;
        if (apkFile == null || !apkFile.isFile()) {
            return;
        }
        if (canInstallPackages()) {
            updateState("installing", currentVersion, apkFile.length(), apkFile.length(), 100, "");
            showCompletedNotification(currentVersion, apkFile, true);
            launchInstaller(apkFile);
        } else {
            updateState(
                "permission_required",
                currentVersion,
                apkFile.length(),
                apkFile.length(),
                100,
                "需要允许安装未知应用才能自动安装。"
            );
            showCompletedNotification(currentVersion, apkFile, false);
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancelRequested.set(true);
        HttpURLConnection connection = activeConnection;
        if (connection != null) {
            connection.disconnect();
        }
        executor.shutdownNow();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url");
        String version = normalizeVersion(call.getString("version"));
        String fileName = sanitizeFileName(call.getString("fileName"), version);

        if (!isAllowedApkUrl(rawUrl) || version.isEmpty()) {
            call.reject("无效的安装包下载地址。");
            return;
        }

        if (downloading.get()) {
            if (rawUrl.equals(activeUrl)) {
                call.resolve(buildStatePayload());
                return;
            }
            call.reject("已有更新正在下载中。");
            return;
        }

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && !notificationPermissionRequested
                && getPermissionState("notifications") != PermissionState.GRANTED
        ) {
            notificationPermissionRequested = true;
            requestPermissionForAlias("notifications", call, "handleNotificationPermissionResult");
            return;
        }

        beginDownload(call, rawUrl, version, fileName);
    }

    @PermissionCallback
    private void handleNotificationPermissionResult(PluginCall call) {
        String rawUrl = call.getString("url");
        String version = normalizeVersion(call.getString("version"));
        String fileName = sanitizeFileName(call.getString("fileName"), version);
        if (!isAllowedApkUrl(rawUrl) || version.isEmpty()) {
            call.reject("无效的安装包下载地址。");
            return;
        }
        beginDownload(call, rawUrl, version, fileName);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        if (!downloading.get()) {
            call.resolve(buildStatePayload());
            return;
        }
        cancelRequested.set(true);
        HttpURLConnection connection = activeConnection;
        if (connection != null) {
            new Thread(connection::disconnect, "inyue-update-cancel").start();
        }
        call.resolve();
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        File apkFile = downloadedApkFile;
        if (apkFile == null || !apkFile.isFile()) {
            call.reject("未找到已下载的安装包，请重新下载。");
            return;
        }
        triggerInstall(apkFile, currentVersion);
        call.resolve(buildStatePayload());
    }

    private void beginDownload(PluginCall call, String rawUrl, String version, String fileName) {
        if (!downloading.compareAndSet(false, true)) {
            call.resolve(buildStatePayload());
            return;
        }

        cancelRequested.set(false);
        activeUrl = rawUrl;
        downloadedApkFile = null;
        waitingForInstallPermission = false;
        ensureNotificationChannel();
        updateState("downloading", version, 0L, -1L, -1, "");
        showProgressNotification(version, 0L, -1L, -1);
        call.resolve(buildStatePayload());

        executor.execute(() -> runDownload(rawUrl, version, fileName));
    }

    private void runDownload(String rawUrl, String version, String fileName) {
        File updatesDir = new File(getContext().getCacheDir(), "apk-updates");
        File partialFile = null;
        HttpURLConnection connection = null;
        boolean completed = false;

        try {
            if (!updatesDir.mkdirs() && !updatesDir.isDirectory()) {
                throw new IOException("无法创建更新缓存目录");
            }
            cleanupDirectory(updatesDir);

            connection = openDownloadConnection(rawUrl);
            activeConnection = connection;

            long totalBytes = connection.getContentLengthLong();
            if (totalBytes > MAX_APK_BYTES) {
                throw new IOException("安装包体积超出限制");
            }

            partialFile = new File(updatesDir, fileName + ".part");
            File targetFile = new File(updatesDir, fileName);

            long downloadedBytes = 0L;
            int lastPercent = -1;
            long lastNotifyAt = 0L;

            try (
                InputStream input = connection.getInputStream();
                OutputStream output = new FileOutputStream(partialFile)
            ) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (cancelRequested.get()) {
                        throw new CancelledDownloadException();
                    }
                    downloadedBytes += read;
                    if (downloadedBytes > MAX_APK_BYTES) {
                        throw new IOException("安装包体积超出限制");
                    }
                    output.write(buffer, 0, read);

                    int percent = totalBytes > 0
                        ? (int) Math.min(100L, (downloadedBytes * 100L) / totalBytes)
                        : -1;
                    long now = SystemClock.elapsedRealtime();
                    boolean shouldUpdate =
                        (percent >= 0 && percent != lastPercent && (now - lastNotifyAt >= NOTIFICATION_THROTTLE_MS || percent == 100))
                            || (percent < 0 && now - lastNotifyAt >= 500L);
                    if (shouldUpdate) {
                        lastPercent = percent;
                        lastNotifyAt = now;
                        updateState("downloading", version, downloadedBytes, totalBytes, percent, "");
                        showProgressNotification(version, downloadedBytes, totalBytes, percent);
                    }
                }
                output.flush();
            }

            if (cancelRequested.get()) {
                throw new CancelledDownloadException();
            }
            if (downloadedBytes <= 0L || (totalBytes > 0L && downloadedBytes != totalBytes)) {
                throw new IOException("安装包下载不完整，请重试。");
            }

            if (targetFile.exists() && !targetFile.delete()) {
                throw new IOException("无法写入新安装包");
            }
            if (!partialFile.renameTo(targetFile)) {
                throw new IOException("无法保存新安装包");
            }
            partialFile = null;
            completed = true;
            downloadedApkFile = targetFile;

            long finalSize = targetFile.length();
            updateState("completed", version, finalSize, finalSize, 100, "");
            triggerInstall(targetFile, version);
        } catch (CancelledDownloadException ignored) {
            clearNotification();
            updateState("idle", version, 0L, -1L, -1, "");
        } catch (IOException | IllegalArgumentException | SecurityException error) {
            String message = error.getMessage();
            if (message == null || message.trim().isEmpty()) {
                message = "下载更新失败，请稍后重试。";
            }
            updateState("error", version, currentDownloadedBytes, currentTotalBytes, currentPercent, message);
            showErrorNotification(message);
        } finally {
            activeConnection = null;
            if (connection != null) {
                connection.disconnect();
            }
            if (!completed && partialFile != null && partialFile.exists()) {
                partialFile.delete();
            }
            activeUrl = "";
            downloading.set(false);
        }
    }

    private HttpURLConnection openDownloadConnection(String rawUrl) throws IOException {
        String nextUrl = rawUrl;
        for (int hops = 0; hops <= MAX_REDIRECTS; hops++) {
            URI uri = URI.create(nextUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                throw new IOException("仅支持 HTTPS 下载地址");
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(nextUrl).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", "inYue-Android");
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
            connection.setRequestProperty("Accept-Encoding", "identity");

            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_OK) {
                return connection;
            }
            if (
                status == HttpURLConnection.HTTP_MOVED_PERM
                    || status == HttpURLConnection.HTTP_MOVED_TEMP
                    || status == HttpURLConnection.HTTP_SEE_OTHER
                    || status == 307
                    || status == 308
            ) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("下载地址重定向无效");
                }
                nextUrl = uri.resolve(location.trim()).toString();
                continue;
            }
            connection.disconnect();
            throw new IOException("下载失败（HTTP " + status + "）");
        }
        throw new IOException("下载地址重定向次数过多");
    }

    private void triggerInstall(File apkFile, String version) {
        boolean allowed = canInstallPackages();
        showCompletedNotification(version, apkFile, allowed);
        if (!allowed) {
            waitingForInstallPermission = true;
            updateState(
                "permission_required",
                version,
                apkFile.length(),
                apkFile.length(),
                100,
                "请开启「安装未知应用」权限以完成安装。"
            );
            openInstallPermissionSettings();
            return;
        }
        updateState("installing", version, apkFile.length(), apkFile.length(), 100, "");
        launchInstaller(apkFile);
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startActivitySafely(intent);
    }

    private void launchInstaller(File apkFile) {
        Intent intent = buildInstallIntent(apkFile);
        if (intent == null) {
            updateState(
                "error",
                currentVersion,
                apkFile.length(),
                apkFile.length(),
                100,
                "无法读取已下载的安装包。"
            );
            return;
        }
        if (!startActivitySafely(intent)) {
            updateState(
                "error",
                currentVersion,
                apkFile.length(),
                apkFile.length(),
                100,
                "无法启动系统安装程序，请点击通知栏重试。"
            );
        }
    }

    private Intent buildInstallIntent(File apkFile) {
        try {
            Context context = getContext();
            Uri apkUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apkFile
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return intent;
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private boolean startActivitySafely(Intent intent) {
        Activity activity = getActivity();
        if (activity != null && !activity.isFinishing() && !activity.isDestroyed()) {
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(intent);
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    // Notification action remains available for manual retry.
                }
            });
            return true;
        }
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException error) {
            return false;
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private boolean canPostNotifications() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED
            ) {
                return false;
            }
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    private void showProgressNotification(String version, long downloadedBytes, long totalBytes, int percent) {
        if (!canPostNotifications()) {
            return;
        }
        Context context = getContext();
        String text = totalBytes > 0 && percent >= 0
            ? String.format(
                Locale.US,
                "%d%% · %s / %s",
                percent,
                formatBytes(downloadedBytes),
                formatBytes(totalBytes)
            )
            : downloadedBytes > 0
                ? "已下载 " + formatBytes(downloadedBytes)
                : "正在连接下载服务器…";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("正在下载 inYue v" + version)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(100, Math.max(0, percent), totalBytes <= 0 || percent < 0);

        PendingIntent openAppIntent = createOpenAppPendingIntent();
        if (openAppIntent != null) {
            builder.setContentIntent(openAppIntent);
        }

        notifySafely(builder);
    }

    private void showCompletedNotification(String version, File apkFile, boolean canInstall) {
        if (!canPostNotifications()) {
            return;
        }
        Context context = getContext();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("inYue v" + version + " 下载完成")
            .setContentText(canInstall ? "点击安装新版本" : "请允许安装未知应用后安装")
            .setOngoing(false)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setProgress(0, 0, false);

        PendingIntent actionIntent = createCompletedPendingIntent(apkFile, canInstall);
        if (actionIntent != null) {
            builder.setContentIntent(actionIntent);
        }

        notifySafely(builder);
    }

    private void showErrorNotification(String message) {
        if (!canPostNotifications()) {
            return;
        }
        Context context = getContext();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("inYue 更新下载失败")
            .setContentText(message)
            .setOngoing(false)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setProgress(0, 0, false);

        PendingIntent openAppIntent = createOpenAppPendingIntent();
        if (openAppIntent != null) {
            builder.setContentIntent(openAppIntent);
        }

        notifySafely(builder);
    }

    private void clearNotification() {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_ID);
    }

    private void notifySafely(NotificationCompat.Builder builder) {
        try {
            NotificationManagerCompat.from(getContext()).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission may have been revoked while downloading.
        }
    }

    private PendingIntent createOpenAppPendingIntent() {
        Context context = getContext();
        Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (intent == null) {
            return null;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent createCompletedPendingIntent(File apkFile, boolean canInstall) {
        Context context = getContext();
        Intent targetIntent;
        if (canInstall) {
            targetIntent = buildInstallIntent(apkFile);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            targetIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName())
            );
            targetIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        } else {
            targetIntent = buildInstallIntent(apkFile);
        }
        if (targetIntent == null) {
            return createOpenAppPendingIntent();
        }
        return PendingIntent.getActivity(
            context,
            NOTIFICATION_ID + 1,
            targetIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void updateState(
        String status,
        String version,
        long downloadedBytes,
        long totalBytes,
        int percent,
        String message
    ) {
        currentStatus = status;
        currentVersion = version;
        currentDownloadedBytes = downloadedBytes;
        currentTotalBytes = totalBytes;
        currentPercent = percent;
        currentMessage = message != null ? message : "";
        notifyListeners("statusChange", buildStatePayload());
    }

    private JSObject buildStatePayload() {
        JSObject payload = new JSObject();
        payload.put("status", currentStatus);
        payload.put("version", currentVersion);
        payload.put("downloadedBytes", currentDownloadedBytes);
        payload.put("totalBytes", currentTotalBytes);
        payload.put("percent", currentPercent);
        if (!currentMessage.isEmpty()) {
            payload.put("message", currentMessage);
        }
        return payload;
    }

    private static boolean isAllowedApkUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            return false;
        }
        try {
            URI uri = URI.create(rawUrl.trim());
            String path = uri.getRawPath();
            return "https".equalsIgnoreCase(uri.getScheme())
                && ALLOWED_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null
                && uri.getFragment() == null
                && path != null
                && path.toLowerCase(Locale.ROOT).startsWith(ALLOWED_PATH_PREFIX)
                && path.toLowerCase(Locale.ROOT).endsWith(".apk");
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static String normalizeVersion(String raw) {
        if (raw == null) {
            return "";
        }
        String trimmed = raw.trim();
        if (trimmed.startsWith("v") || trimmed.startsWith("V")) {
            return trimmed.substring(1);
        }
        return trimmed;
    }

    private static String sanitizeFileName(String rawName, String version) {
        String fallback = "inyue-v" + (version.isEmpty() ? "latest" : version) + ".apk";
        if (rawName == null || rawName.trim().isEmpty()) {
            return fallback;
        }
        String cleaned = rawName.trim().replaceAll("[^A-Za-z0-9._-]", "_");
        if (!cleaned.toLowerCase(Locale.ROOT).endsWith(".apk") || cleaned.length() <= 4) {
            return fallback;
        }
        return cleaned;
    }

    private static void cleanupDirectory(File dir) {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (file.isFile()) {
                file.delete();
            }
        }
    }

    private static String formatBytes(long bytes) {
        if (bytes >= 1024L * 1024L) {
            return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
        }
        if (bytes >= 1024L) {
            return String.format(Locale.US, "%.0f KB", bytes / 1024.0);
        }
        return bytes + " B";
    }

    private static final class CancelledDownloadException extends IOException {}
}
