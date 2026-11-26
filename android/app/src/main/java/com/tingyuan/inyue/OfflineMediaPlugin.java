package com.tingyuan.inyue;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "OfflineMedia")
public class OfflineMediaPlugin extends Plugin {
    private static final String PREFS_NAME = "inyue_offline_media";
    private static final String KEY_TREE_URI = "tree_uri";
    private static final String NOMEDIA = ".nomedia";
    private static final long PRIVATE_QUOTA = 256L * 1024 * 1024;
    private static final long SHARE_TTL_MS = 30L * 60L * 1000L;
    private static final int SHARE_MAX_ENTRIES = 3;
    private static final Pattern ID = Pattern.compile("[a-f0-9-]{36}");
    private static final String[] AUDIO = { ".mp3" };
    private static final String[] COVERS = { ".jpg", ".png", ".webp" };
    private static final String[] DOC_PROJECTION = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    };

    private final ExecutorService writes = Executors.newSingleThreadExecutor();
    private final Object safCacheLock = new Object();
    private final Object legacyMigrationLock = new Object();
    private final Map<String, PendingExport> pendingExports = new ConcurrentHashMap<>();
    private String cachedTreeUri;
    private String cachedOwnerKey;
    private String cachedScopeDocId;
    private Map<String, SafEntry> cachedSafEntries;

    private static final class PendingExport {
        final File file;
        final boolean deleteAfter;
        final String fileName;

        PendingExport(File file, boolean deleteAfter, String fileName) {
            this.file = file;
            this.deleteAfter = deleteAfter;
            this.fileName = fileName;
        }
    }

    private static final class DownloadedMedia {
        final File file;
        final String extension;
        final int bytes;

        DownloadedMedia(File file, String extension, int bytes) {
            this.file = file;
            this.extension = extension;
            this.bytes = bytes;
        }
    }

    private static final class SafEntry {
        final String documentId;
        final Uri uri;
        final long size;
        final long lastModified;

        SafEntry(String documentId, Uri uri, long size, long lastModified) {
            this.documentId = documentId;
            this.uri = uri;
            this.size = size;
            this.lastModified = lastModified;
        }
    }

    private static final class SafScope {
        final Uri treeUri;
        final String rootDocId;
        final String scopeDocId;
        final Map<String, SafEntry> entries;

        SafScope(Uri treeUri, String rootDocId, String scopeDocId, Map<String, SafEntry> entries) {
            this.treeUri = treeUri;
            this.rootDocId = rootDocId;
            this.scopeDocId = scopeDocId;
            this.entries = entries;
        }
    }

    @Override
    protected void handleOnResume() {
        invalidateSafCache();
    }

    @Override
    protected void handleOnDestroy() {
        for (PendingExport pending : pendingExports.values()) {
            if (pending.deleteAfter && pending.file != null) {
                pending.file.delete();
            }
        }
        pendingExports.clear();
        writes.shutdown();
    }

    @PluginMethod
    public void read(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        String kind = call.getString("kind");
        String id = call.getString("id");
        if (ownerKey == null || !validKind(kind) || !validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        migrateLegacyCache(ownerKey, legacyScope);
        JSObject result = new JSObject();
        Uri treeUri = savedTreeUri();
        SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
        if (saf != null) {
            SafEntry entry = cachedSaf(saf.entries, kind, id);
            if (entry != null) {
                result.put("uri", entry.uri.toString());
            }
            call.resolve(result);
            return;
        }
        File file = cachedFile(privateScopeDir(ownerKey), kind, id);
        if (file != null) {
            file.setLastModified(System.currentTimeMillis());
            result.put("uri", Uri.fromFile(file).toString());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void readMany(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        String kind = call.getString("kind");
        JSArray ids = call.getArray("ids");
        if (ownerKey == null || !validKind(kind) || ids == null) {
            call.reject("Invalid media key");
            return;
        }
        migrateLegacyCache(ownerKey, legacyScope);
        JSObject uris = new JSObject();
        Uri treeUri = savedTreeUri();
        SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
        if (saf != null) {
            for (int index = 0; index < ids.length(); index++) {
                String id = ids.optString(index, "");
                if (!validId(id)) continue;
                SafEntry entry = cachedSaf(saf.entries, kind, id);
                if (entry != null) {
                    uris.put(id, entry.uri.toString());
                }
            }
            call.resolve(new JSObject().put("uris", uris));
            return;
        }
        File directory = privateScopeDir(ownerKey);
        long now = System.currentTimeMillis();
        for (int index = 0; index < ids.length(); index++) {
            String id = ids.optString(index, "");
            if (!validId(id)) continue;
            File file = cachedFile(directory, kind, id);
            if (file != null) {
                file.setLastModified(now);
                uris.put(id, Uri.fromFile(file).toString());
            }
        }
        call.resolve(new JSObject().put("uris", uris));
    }

    @PluginMethod
    public void listAudio(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        if (ownerKey == null) {
            call.reject("Invalid media scope");
            return;
        }
        migrateLegacyCache(ownerKey, legacyScope);
        JSObject sources = new JSObject();
        Uri treeUri = savedTreeUri();
        SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
        if (saf != null) {
            for (Map.Entry<String, SafEntry> item : saf.entries.entrySet()) {
                String name = item.getKey();
                if (!name.startsWith("audio-") || !name.endsWith(".mp3")) continue;
                String id = name.substring(6, name.length() - 4);
                SafEntry entry = item.getValue();
                if (validId(id) && usableSize(entry.size, "audio")) {
                    sources.put(id, entry.uri.toString());
                }
            }
            call.resolve(new JSObject().put("sources", sources));
            return;
        }
        for (File file : files(privateScopeDir(ownerKey))) {
            String name = file.getName();
            if (!name.startsWith("audio-") || !name.endsWith(".mp3")) continue;
            String id = name.substring(6, name.length() - 4);
            if (validId(id) && usableSize(file.length(), "audio")) {
                sources.put(id, Uri.fromFile(file).toString());
            }
        }
        call.resolve(new JSObject().put("sources", sources));
    }

    @PluginMethod
    public void download(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        String kind = call.getString("kind");
        String id = call.getString("id");
        if (ownerKey == null || !validKind(kind) || !validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        writes.execute(() -> {
            try {
                migrateLegacyCache(ownerKey, legacyScope);
                save(ownerKey, kind, id, call);
                call.resolve();
            } catch (IOException | IllegalArgumentException | SecurityException error) {
                call.reject("Unable to cache media");
            }
        });
    }

    @PluginMethod
    public void exportAudio(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        String id = call.getString("id");
        String url = call.getString("url");
        String origin = call.getString("origin");
        if (!validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        String safeFileName = sanitizeExportFileName(call.getString("fileName"));
        writes.execute(() -> {
            try {
                SafEntry safEntry = null;
                File privateFile = null;
                if (ownerKey != null) {
                    migrateLegacyCache(ownerKey, legacyScope);
                    Uri treeUri = savedTreeUri();
                    SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
                    if (saf != null) {
                        safEntry = cachedSaf(saf.entries, "audio", id);
                    } else {
                        privateFile = cachedFile(privateScopeDir(ownerKey), "audio", id);
                    }
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    String exportedName = exportToMediaStoreDownloads(safeFileName, safEntry, privateFile, url, origin);
                    JSObject result = new JSObject();
                    result.put("canceled", false);
                    result.put("fileName", exportedName);
                    result.put("directory", Environment.DIRECTORY_DOWNLOADS);
                    call.resolve(result);
                    return;
                }

                PendingExport pending = stageExportFile(safeFileName, safEntry, privateFile, url, origin);
                Activity activity = getActivity();
                if (activity == null || activity.isFinishing()) {
                    if (pending.deleteAfter) {
                        pending.file.delete();
                    }
                    call.reject("Unable to export audio");
                    return;
                }
                pendingExports.put(call.getCallbackId(), pending);
                activity.runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("audio/mpeg");
                    intent.putExtra(Intent.EXTRA_TITLE, safeFileName);
                    startActivityForResult(call, intent, "handleExportAudioDocument");
                });
            } catch (IOException | IllegalArgumentException | SecurityException error) {
                call.reject("下载歌曲失败，请稍后重试。");
            }
        });
    }

    @ActivityCallback
    private void handleExportAudioDocument(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        PendingExport pending = pendingExports.remove(call.getCallbackId());
        if (pending == null) {
            call.reject("下载歌曲失败，请稍后重试。");
            return;
        }
        Intent data = result.getData();
        Uri targetUri = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || targetUri == null) {
            if (pending.deleteAfter) {
                pending.file.delete();
            }
            call.resolve(new JSObject().put("canceled", true));
            return;
        }
        writes.execute(() -> {
            try {
                ContentResolver resolver = getContext().getContentResolver();
                try (
                    InputStream input = new FileInputStream(pending.file);
                    OutputStream output = resolver.openOutputStream(targetUri, "w")
                ) {
                    if (output == null) {
                        throw new IOException("Unable to open destination stream");
                    }
                    copyStream(input, output);
                }
                String actualName = queryDisplayName(resolver, targetUri);
                JSObject response = new JSObject();
                response.put("canceled", false);
                response.put("fileName", actualName != null ? actualName : pending.fileName);
                call.resolve(response);
            } catch (IOException | SecurityException error) {
                call.reject("下载歌曲失败，请稍后重试。");
            } finally {
                if (pending.deleteAfter) {
                    pending.file.delete();
                }
            }
        });
    }

    @PluginMethod
    public void prepareShareAudio(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        String id = call.getString("id");
        String url = call.getString("url");
        String origin = call.getString("origin");
        if (!validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        String safeFileName = sanitizeExportFileName(call.getString("fileName"));
        writes.execute(() -> {
            try {
                pruneShareDir();
                SafEntry safEntry = null;
                File privateFile = null;
                if (ownerKey != null) {
                    migrateLegacyCache(ownerKey, legacyScope);
                    Uri treeUri = savedTreeUri();
                    SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
                    if (saf != null) {
                        safEntry = cachedSaf(saf.entries, "audio", id);
                    } else {
                        privateFile = cachedFile(privateScopeDir(ownerKey), "audio", id);
                    }
                }
                File staged = stageShareFile(safeFileName, safEntry, privateFile, url, origin);
                JSObject result = new JSObject();
                result.put("uri", shareFileUri(staged));
                result.put("fileName", safeFileName);
                call.resolve(result);
            } catch (IOException | IllegalArgumentException | SecurityException error) {
                call.reject("分享歌曲失败，请稍后重试。");
            }
        });
    }

    @PluginMethod
    public void openDownloads(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            call.reject("无法打开下载目录");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Intent downloadsIntent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
                activity.startActivity(downloadsIntent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // Fall back to opening the primary Download directory in DocumentsUI.
            }
            try {
                Uri downloadsUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents",
                    "primary:" + Environment.DIRECTORY_DOWNLOADS
                );
                Intent folderIntent = new Intent(Intent.ACTION_VIEW);
                folderIntent.setDataAndType(downloadsUri, DocumentsContract.Document.MIME_TYPE_DIR);
                folderIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(folderIntent);
                call.resolve();
            } catch (ActivityNotFoundException | SecurityException error) {
                call.reject("无法打开下载目录");
            }
        });
    }

    @PluginMethod
    public void removeAudio(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        String id = call.getString("id");
        if (ownerKey == null || !validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        writes.execute(() -> {
            migrateLegacyCache(ownerKey, legacyScope);
            String fileName = "audio-" + id + ".mp3";
            Uri treeUri = savedTreeUri();
            SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
            if (saf != null) {
                SafEntry entry = saf.entries.get(fileName);
                if (entry != null) {
                    deleteSafDocument(entry.uri);
                    removeSafCacheEntry(treeUri, ownerKey, fileName);
                }
            }
            new File(privateScopeDir(ownerKey), fileName).delete();
            call.resolve();
        });
    }

    @PluginMethod
    public void clean(PluginCall call) {
        String owner = call.getString("owner");
        String ownerKey = ownerKey(owner);
        String legacyScope = call.getString("legacyScope");
        boolean removeScope = Boolean.TRUE.equals(call.getBoolean("removeScope", false));
        if (ownerKey == null && !validId(legacyScope)) {
            call.reject("Invalid media scope");
            return;
        }
        writes.execute(() -> {
            if (ownerKey == null) {
                if (removeScope && validId(legacyScope)) {
                    deleteDirectory(legacyCacheDir(legacyScope));
                }
                call.resolve();
                return;
            }
            migrateLegacyCache(ownerKey, legacyScope);
            cleanTempDir();
            if (removeScope) {
                deleteDirectory(shareDir());
                Uri treeUri = savedTreeUri();
                SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
                if (saf != null) {
                    for (SafEntry entry : saf.entries.values()) {
                        deleteSafDocument(entry.uri);
                    }
                    invalidateSafCache();
                }
                deleteDirectory(privateScopeDir(ownerKey));
                call.resolve();
                return;
            }
            pruneShareDir();
            File privateDir = privateScopeDir(ownerKey);
            for (File file : files(privateDir)) {
                if (file.getName().endsWith(".part")) {
                    file.delete();
                }
            }
            Uri treeUri = savedTreeUri();
            if (treeUri == null || resolveRootDocId(treeUri) == null) {
                prunePrivate(privateDir, 0);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void getStorageInfo(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        if (ownerKey == null) {
            call.reject("Invalid media scope");
            return;
        }
        writes.execute(() -> {
            migrateLegacyCache(ownerKey, legacyScope);
            invalidateSafCache();
            call.resolve(buildStorageInfo(ownerKey));
        });
    }

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        if (ownerKey == null) {
            call.reject("Invalid media scope");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Uri current = savedTreeUri();
            if (current != null && resolveRootDocId(current) != null) {
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, current);
            }
        }
        startActivityForResult(call, intent, "handlePickDirectory");
    }

    @ActivityCallback
    private void handlePickDirectory(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        if (ownerKey == null) {
            call.reject("Invalid media scope");
            return;
        }
        Intent data = result.getData();
        Uri pickedUri = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || pickedUri == null) {
            writes.execute(() -> {
                JSObject info = buildStorageInfo(ownerKey);
                info.put("canceled", true);
                call.resolve(info);
            });
            return;
        }
        int rawFlags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        int persistFlags = rawFlags == 0
            ? (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            : rawFlags;
        try {
            getContext().getContentResolver().takePersistableUriPermission(pickedUri, persistFlags);
        } catch (SecurityException error) {
            call.reject("无法获取目录持久访问权限");
            return;
        }
        writes.execute(() -> {
            Uri previousUri = savedTreeUri();
            invalidateSafCache();
            SafScope saf = openSafScope(pickedUri, ownerKey, true);
            if (saf == null || saf.scopeDocId == null) {
                if (previousUri == null || !previousUri.equals(pickedUri)) {
                    releaseTreePermission(pickedUri);
                }
                call.reject("所选目录不可写入，请更换其他目录");
                return;
            }
            saveTreeUri(pickedUri);
            if (previousUri != null && !previousUri.equals(pickedUri)) {
                releaseTreePermission(previousUri);
            }
            migrateLegacyCache(ownerKey, legacyScope);
            int migratedAudio = migratePrivateToSaf(ownerKey, saf);
            invalidateSafCache();
            JSObject info = buildStorageInfo(ownerKey);
            info.put("canceled", false);
            info.put("migratedCount", migratedAudio);
            call.resolve(info);
        });
    }

    @PluginMethod
    public void resetDirectory(PluginCall call) {
        String ownerKey = ownerKey(call.getString("owner"));
        String legacyScope = call.getString("legacyScope");
        if (ownerKey == null) {
            call.reject("Invalid media scope");
            return;
        }
        writes.execute(() -> {
            Uri previous = savedTreeUri();
            clearTreeUri();
            invalidateSafCache();
            if (previous != null) {
                releaseTreePermission(previous);
            }
            migrateLegacyCache(ownerKey, legacyScope);
            call.resolve(buildStorageInfo(ownerKey));
        });
    }

    private void save(String ownerKey, String kind, String id, PluginCall call) throws IOException {
        Uri treeUri = savedTreeUri();
        SafScope saf = treeUri != null ? openSafScope(treeUri, ownerKey, false) : null;
        if (saf != null) {
            if (cachedSaf(saf.entries, kind, id) != null) {
                return;
            }
        } else {
            File existing = cachedFile(privateScopeDir(ownerKey), kind, id);
            if (existing != null) {
                existing.setLastModified(System.currentTimeMillis());
                return;
            }
        }

        DownloadedMedia downloaded = downloadToTempFile(kind, call.getString("url", ""), call.getString("origin", ""));
        try {
            String fileName = kind + "-" + id + downloaded.extension;
            Uri activeTree = savedTreeUri();
            SafScope writableSaf = activeTree != null ? openSafScope(activeTree, ownerKey, true) : null;
            if (writableSaf != null && writableSaf.scopeDocId != null) {
                commitToSaf(
                    writableSaf,
                    ownerKey,
                    fileName,
                    mimeType(downloaded.extension),
                    downloaded.file,
                    downloaded.bytes
                );
                return;
            }
            File directory = privateScopeDir(ownerKey);
            if (!directory.mkdirs() && !directory.isDirectory()) {
                throw new IOException("Missing media directory");
            }
            prunePrivate(directory, downloaded.bytes);
            File target = new File(directory, fileName);
            commitFile(downloaded.file, target);
            target.setLastModified(System.currentTimeMillis());
        } finally {
            downloaded.file.delete();
        }
    }

    private DownloadedMedia downloadToTempFile(String kind, String rawUrl, String rawOrigin) throws IOException {
        if (rawUrl == null || rawOrigin == null || rawUrl.isEmpty() || rawOrigin.isEmpty()) {
            throw new IOException("Missing media source");
        }
        URI source = URI.create(rawUrl);
        URI origin = URI.create(rawOrigin);
        boolean local = "http".equals(source.getScheme()) && "127.0.0.1".equals(source.getHost())
            && (source.getPort() == 8794 || source.getPort() == 5223);
        if ((!local && !"https".equals(source.getScheme())) || source.getHost() == null
            || source.getUserInfo() != null || source.getFragment() != null
            || !source.getScheme().equals(origin.getScheme())
            || !source.getRawAuthority().equals(origin.getRawAuthority())
            || !source.getRawPath().matches("/api/media/[a-f0-9-]{36}") || source.getRawQuery() == null) {
            throw new IOException("Invalid media source");
        }

        File tmpDir = tempDir();
        if (!tmpDir.mkdirs() && !tmpDir.isDirectory()) {
            throw new IOException("Missing temp directory");
        }

        HttpURLConnection request = (HttpURLConnection) source.toURL().openConnection();
        request.setConnectTimeout(5000);
        request.setReadTimeout(10000);
        request.setInstanceFollowRedirects(false);
        request.setUseCaches(false);
        request.setRequestProperty("Accept-Encoding", "identity");
        File partial = null;
        boolean success = false;
        try {
            if (request.getResponseCode() != HttpURLConnection.HTTP_OK || request.getHeaderField("Content-Range") != null) {
                throw new IOException("Invalid media response");
            }
            String extension = extension(kind, request.getContentType());
            int length = request.getContentLength();
            int limit = maxBytes(kind);
            if (extension == null || length == 0 || length > limit) {
                throw new IOException("Invalid media headers");
            }
            partial = File.createTempFile("download-", ".part", tmpDir);
            int bytes = 0;
            try (InputStream input = request.getInputStream(); OutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    bytes += count;
                    if (bytes > limit || (length >= 0 && bytes > length)) {
                        throw new IOException("Media too large");
                    }
                    output.write(buffer, 0, count);
                }
            }
            if (bytes == 0 || (length >= 0 && bytes != length)) {
                throw new IOException("Incomplete media");
            }
            success = true;
            return new DownloadedMedia(partial, extension, bytes);
        } finally {
            request.disconnect();
            if (!success && partial != null) {
                partial.delete();
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private String exportToMediaStoreDownloads(
        String fileName,
        SafEntry safEntry,
        File privateFile,
        String url,
        String origin
    ) throws IOException {
        if (safEntry != null) {
            try (InputStream input = getContext().getContentResolver().openInputStream(safEntry.uri)) {
                if (input == null) {
                    throw new IOException("Unable to read cached audio");
                }
                return writeToMediaStoreDownloads(fileName, input);
            }
        }
        if (privateFile != null) {
            try (InputStream input = new FileInputStream(privateFile)) {
                return writeToMediaStoreDownloads(fileName, input);
            }
        }
        DownloadedMedia downloaded = downloadToTempFile("audio", url, origin);
        try (InputStream input = new FileInputStream(downloaded.file)) {
            return writeToMediaStoreDownloads(fileName, input);
        } finally {
            downloaded.file.delete();
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private String writeToMediaStoreDownloads(String fileName, InputStream input) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        values.put(MediaStore.Downloads.MIME_TYPE, "audio/mpeg");
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri targetUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (targetUri == null) {
            throw new IOException("Unable to create download entry");
        }
        try (OutputStream output = resolver.openOutputStream(targetUri, "w")) {
            if (output == null) {
                throw new IOException("Unable to open download stream");
            }
            copyStream(input, output);
        } catch (IOException | RuntimeException error) {
            resolver.delete(targetUri, null, null);
            throw error instanceof IOException ? (IOException) error : new IOException(error);
        }
        ContentValues completed = new ContentValues();
        completed.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(targetUri, completed, null, null);
        String actualName = queryDisplayName(resolver, targetUri);
        return actualName != null ? actualName : fileName;
    }

    private PendingExport stageExportFile(
        String fileName,
        SafEntry safEntry,
        File privateFile,
        String url,
        String origin
    ) throws IOException {
        if (privateFile != null) {
            return new PendingExport(privateFile, false, fileName);
        }
        if (safEntry != null) {
            File tmpDir = tempDir();
            if (!tmpDir.mkdirs() && !tmpDir.isDirectory()) {
                throw new IOException("Missing temp directory");
            }
            File staged = File.createTempFile("export-", ".part", tmpDir);
            try (
                InputStream input = getContext().getContentResolver().openInputStream(safEntry.uri);
                OutputStream output = new FileOutputStream(staged)
            ) {
                if (input == null) {
                    throw new IOException("Unable to read cached audio");
                }
                copyStream(input, output);
                return new PendingExport(staged, true, fileName);
            } catch (IOException | RuntimeException error) {
                staged.delete();
                throw error instanceof IOException ? (IOException) error : new IOException(error);
            }
        }
        DownloadedMedia downloaded = downloadToTempFile("audio", url, origin);
        return new PendingExport(downloaded.file, true, fileName);
    }

    private File stageShareFile(
        String fileName,
        SafEntry safEntry,
        File privateFile,
        String url,
        String origin
    ) throws IOException {
        File targetDir = new File(shareDir(), UUID.randomUUID().toString());
        if (!targetDir.mkdirs() && !targetDir.isDirectory()) {
            throw new IOException("Missing share directory");
        }
        File targetFile = new File(targetDir, fileName);
        boolean success = false;
        try {
            if (safEntry != null) {
                try (
                    InputStream input = getContext().getContentResolver().openInputStream(safEntry.uri);
                    OutputStream output = new FileOutputStream(targetFile)
                ) {
                    if (input == null) {
                        throw new IOException("Unable to read cached audio");
                    }
                    copyStream(input, output);
                }
            } else if (privateFile != null) {
                try (
                    InputStream input = new FileInputStream(privateFile);
                    OutputStream output = new FileOutputStream(targetFile)
                ) {
                    copyStream(input, output);
                }
            } else {
                DownloadedMedia downloaded = downloadToTempFile("audio", url, origin);
                try {
                    commitFile(downloaded.file, targetFile);
                } catch (IOException error) {
                    downloaded.file.delete();
                    throw error;
                }
            }
            long now = System.currentTimeMillis();
            targetFile.setLastModified(now);
            targetDir.setLastModified(now);
            success = true;
            return targetFile;
        } finally {
            if (!success) {
                deleteDirectory(targetDir);
            }
        }
    }

    private static String shareFileUri(File file) {
        return Uri.fromFile(file)
            .toString()
            .replace("!", "%21")
            .replace("'", "%27")
            .replace("*", "%2A")
            .replace("~", "%7E");
    }

    private static String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) {
                    return name;
                }
            }
        } catch (RuntimeException ignored) {
            // Fall back to requested file name.
        }
        return null;
    }

    private static String sanitizeExportFileName(String raw) {
        String source = raw == null ? "" : raw;
        StringBuilder builder = new StringBuilder(source.length());
        for (int index = 0; index < source.length(); index++) {
            char ch = source.charAt(index);
            if (ch < 0x20 || ch == 0x7f || "<>:\"/\\|?*".indexOf(ch) >= 0) {
                continue;
            }
            builder.append(ch);
        }
        String cleaned = builder.toString().replaceAll("\\s+", " ").replaceAll("^[.\\s]+|[.\\s]+$", "");
        if (cleaned.toLowerCase(Locale.ROOT).endsWith(".mp3")) {
            cleaned = cleaned.substring(0, cleaned.length() - 4).replaceAll("[.\\s]+$", "");
        }
        if (cleaned.length() > 120) {
            cleaned = cleaned.substring(0, 120).replaceAll("[.\\s]+$", "");
        }
        if (cleaned.isEmpty()) {
            cleaned = "未命名歌曲";
        }
        return cleaned + ".mp3";
    }

    private void commitToSaf(
        SafScope saf,
        String ownerKey,
        String fileName,
        String mime,
        File source,
        long bytes
    ) throws IOException {
        SafEntry existing = saf.entries.get(fileName);
        if (existing != null) {
            if (existing.size == bytes) {
                return;
            }
            deleteSafDocument(existing.uri);
            removeSafCacheEntry(saf.treeUri, ownerKey, fileName);
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri scopeDocUri = DocumentsContract.buildDocumentUriUsingTree(saf.treeUri, saf.scopeDocId);
        Uri created = DocumentsContract.createDocument(resolver, scopeDocUri, mime, fileName);
        if (created == null) {
            throw new IOException("Unable to create SAF document");
        }
        try (InputStream input = new FileInputStream(source); OutputStream output = resolver.openOutputStream(created, "w")) {
            if (output == null) {
                throw new IOException("Unable to open SAF output stream");
            }
            copyStream(input, output);
        } catch (IOException | SecurityException error) {
            deleteSafDocument(created);
            throw error instanceof IOException ? (IOException) error : new IOException(error);
        }
        String docId = DocumentsContract.getDocumentId(created);
        SafEntry entry = new SafEntry(docId, created, bytes, System.currentTimeMillis());
        putSafCacheEntry(saf.treeUri, ownerKey, saf.scopeDocId, fileName, entry);
    }

    private int migratePrivateToSaf(String ownerKey, SafScope saf) {
        File privateDir = privateScopeDir(ownerKey);
        File[] list = files(privateDir);
        int migratedAudio = 0;
        for (File file : list) {
            String name = file.getName();
            String kind = kindOfFileName(name);
            String ext = extensionOfFileName(name);
            if (kind == null || ext == null || !usableSize(file.length(), kind)) {
                if (name.endsWith(".part")) {
                    file.delete();
                }
                continue;
            }
            SafEntry existing = saf.entries.get(name);
            if (existing != null && usableSize(existing.size, kind)) {
                file.delete();
                continue;
            }
            try {
                commitToSaf(saf, ownerKey, name, mimeType(ext), file, file.length());
                if ("audio".equals(kind)) {
                    migratedAudio++;
                }
                file.delete();
            } catch (IOException | SecurityException ignored) {
                // Keep private copy if migrating this file failed.
            }
        }
        deleteDirectoryIfEmpty(privateDir);
        return migratedAudio;
    }

    private void migrateLegacyCache(String ownerKey, String legacyScope) {
        if (!validId(legacyScope)) {
            return;
        }
        File legacyDir = legacyCacheDir(legacyScope);
        if (!legacyDir.isDirectory()) {
            return;
        }
        synchronized (legacyMigrationLock) {
            if (!legacyDir.isDirectory()) {
                return;
            }
            File targetDir = privateScopeDir(ownerKey);
            if (!targetDir.mkdirs() && !targetDir.isDirectory()) {
                return;
            }
            for (File file : files(legacyDir)) {
                String name = file.getName();
                String kind = kindOfFileName(name);
                if (kind == null || !usableSize(file.length(), kind)) {
                    file.delete();
                    continue;
                }
                File target = new File(targetDir, name);
                if (target.isFile() && usableSize(target.length(), kind)) {
                    file.delete();
                    continue;
                }
                try {
                    long mtime = file.lastModified();
                    commitFile(file, target);
                    if (mtime > 0) {
                        target.setLastModified(mtime);
                    }
                } catch (IOException ignored) {
                    // Leave file in legacy directory for retry.
                }
            }
            deleteDirectoryIfEmpty(legacyDir);
            deleteDirectoryIfEmpty(legacyDir.getParentFile());
        }
    }

    private JSObject buildStorageInfo(String ownerKey) {
        Uri treeUri = savedTreeUri();
        JSObject info = new JSObject();
        int audioCount = 0;
        long totalBytes = 0;
        if (treeUri != null) {
            SafScope saf = openSafScope(treeUri, ownerKey, false);
            boolean available = saf != null;
            info.put("mode", "directory");
            info.put("directoryLabel", formatTreeLabel(treeUri, available));
            info.put("directoryAvailable", available);
            if (available) {
                for (Map.Entry<String, SafEntry> item : saf.entries.entrySet()) {
                    String name = item.getKey();
                    String kind = kindOfFileName(name);
                    SafEntry entry = item.getValue();
                    if (kind == null || !usableSize(entry.size, kind)) continue;
                    totalBytes += entry.size;
                    if ("audio".equals(kind)) {
                        audioCount++;
                    }
                }
            } else {
                long[] stats = privateStats(privateScopeDir(ownerKey));
                audioCount = (int) stats[0];
                totalBytes = stats[1];
            }
        } else {
            info.put("mode", "private");
            info.put("directoryAvailable", true);
            long[] stats = privateStats(privateScopeDir(ownerKey));
            audioCount = (int) stats[0];
            totalBytes = stats[1];
        }
        info.put("audioCount", audioCount);
        info.put("totalBytes", totalBytes);
        return info;
    }

    private long[] privateStats(File directory) {
        long audioCount = 0;
        long totalBytes = 0;
        for (File file : files(directory)) {
            String kind = kindOfFileName(file.getName());
            long length = file.length();
            if (kind == null || !usableSize(length, kind)) continue;
            totalBytes += length;
            if ("audio".equals(kind)) {
                audioCount++;
            }
        }
        return new long[] { audioCount, totalBytes };
    }

    private SafScope openSafScope(Uri treeUri, String ownerKey, boolean create) {
        String uriString = treeUri.toString();
        synchronized (safCacheLock) {
            if (uriString.equals(cachedTreeUri)
                && ownerKey.equals(cachedOwnerKey)
                && cachedSafEntries != null
                && (!create || cachedScopeDocId != null)) {
                String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
                return new SafScope(treeUri, rootDocId, cachedScopeDocId, new HashMap<>(cachedSafEntries));
            }
        }

        String rootDocId = resolveRootDocId(treeUri);
        if (rootDocId == null) {
            invalidateSafCache();
            return null;
        }

        String scopeDocId = findChildDocumentId(treeUri, rootDocId, ownerKey, DocumentsContract.Document.MIME_TYPE_DIR);
        if (scopeDocId == null) {
            if (!create) {
                Map<String, SafEntry> empty = new HashMap<>();
                synchronized (safCacheLock) {
                    cachedTreeUri = uriString;
                    cachedOwnerKey = ownerKey;
                    cachedScopeDocId = null;
                    cachedSafEntries = empty;
                }
                return new SafScope(treeUri, rootDocId, null, new HashMap<>());
            }
            if (!ensureNoMedia(treeUri, rootDocId)) {
                return null;
            }
            ContentResolver resolver = getContext().getContentResolver();
            Uri rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);
            Uri createdDir;
            try {
                createdDir = DocumentsContract.createDocument(
                    resolver,
                    rootDocUri,
                    DocumentsContract.Document.MIME_TYPE_DIR,
                    ownerKey
                );
            } catch (FileNotFoundException | RuntimeException error) {
                return null;
            }
            if (createdDir == null) {
                return null;
            }
            scopeDocId = DocumentsContract.getDocumentId(createdDir);
            ensureNoMedia(treeUri, scopeDocId);
        } else if (create) {
            ensureNoMedia(treeUri, rootDocId);
            ensureNoMedia(treeUri, scopeDocId);
        }

        Map<String, SafEntry> entries = querySafEntries(treeUri, scopeDocId);
        if (entries == null) {
            invalidateSafCache();
            return null;
        }
        synchronized (safCacheLock) {
            cachedTreeUri = uriString;
            cachedOwnerKey = ownerKey;
            cachedScopeDocId = scopeDocId;
            cachedSafEntries = new HashMap<>(entries);
        }
        return new SafScope(treeUri, rootDocId, scopeDocId, entries);
    }

    private String resolveRootDocId(Uri treeUri) {
        if (treeUri == null || !hasPersistedTreePermission(treeUri)) {
            return null;
        }
        String rootDocId;
        try {
            rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
        } catch (IllegalArgumentException error) {
            return null;
        }
        if (rootDocId == null || rootDocId.isEmpty()) {
            return null;
        }
        Uri rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);
        try (Cursor cursor = getContext().getContentResolver().query(
            rootDocUri,
            new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_MIME_TYPE },
            null,
            null,
            null
        )) {
            if (cursor == null || !cursor.moveToFirst()) {
                return null;
            }
            String mime = cursor.getString(1);
            return DocumentsContract.Document.MIME_TYPE_DIR.equals(mime) ? rootDocId : null;
        } catch (RuntimeException error) {
            return null;
        }
    }

    private boolean hasPersistedTreePermission(Uri treeUri) {
        List<UriPermission> permissions = getContext().getContentResolver().getPersistedUriPermissions();
        for (UriPermission permission : permissions) {
            if (treeUri.equals(permission.getUri()) && permission.isReadPermission() && permission.isWritePermission()) {
                return true;
            }
        }
        return false;
    }

    private String findChildDocumentId(Uri treeUri, String parentDocId, String name, String expectedMime) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId);
        try (Cursor cursor = getContext().getContentResolver().query(
            childrenUri,
            new String[] {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            },
            null,
            null,
            null
        )) {
            if (cursor == null) {
                return null;
            }
            while (cursor.moveToNext()) {
                String docId = cursor.getString(0);
                String displayName = cursor.getString(1);
                String mime = cursor.getString(2);
                if (!name.equals(displayName)) continue;
                if (expectedMime != null && !expectedMime.equals(mime)) continue;
                return docId;
            }
        } catch (RuntimeException ignored) {
            return null;
        }
        return null;
    }

    private boolean ensureNoMedia(Uri treeUri, String parentDocId) {
        if (findChildDocumentId(treeUri, parentDocId, NOMEDIA, null) != null) {
            return true;
        }
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId);
        try {
            Uri created = DocumentsContract.createDocument(
                getContext().getContentResolver(),
                parentUri,
                "application/octet-stream",
                NOMEDIA
            );
            return created != null;
        } catch (FileNotFoundException | RuntimeException error) {
            return false;
        }
    }

    private Map<String, SafEntry> querySafEntries(Uri treeUri, String scopeDocId) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, scopeDocId);
        Map<String, SafEntry> entries = new HashMap<>();
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, DOC_PROJECTION, null, null, null)) {
            if (cursor == null) {
                return null;
            }
            while (cursor.moveToNext()) {
                String docId = cursor.getString(0);
                String displayName = cursor.getString(1);
                String mime = cursor.getString(2);
                long size = cursor.isNull(3) ? 0L : cursor.getLong(3);
                long lastModified = cursor.isNull(4) ? 0L : cursor.getLong(4);
                if (docId == null || displayName == null || DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    continue;
                }
                if (NOMEDIA.equals(displayName) || displayName.endsWith(".part")) {
                    continue;
                }
                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                entries.put(displayName, new SafEntry(docId, docUri, size, lastModified));
            }
            return entries;
        } catch (RuntimeException error) {
            return null;
        }
    }

    private void deleteSafDocument(Uri docUri) {
        try {
            DocumentsContract.deleteDocument(getContext().getContentResolver(), docUri);
        } catch (FileNotFoundException | RuntimeException ignored) {
            // Document may have been removed externally.
        }
    }

    private void invalidateSafCache() {
        synchronized (safCacheLock) {
            cachedTreeUri = null;
            cachedOwnerKey = null;
            cachedScopeDocId = null;
            cachedSafEntries = null;
        }
    }

    private void putSafCacheEntry(Uri treeUri, String ownerKey, String scopeDocId, String name, SafEntry entry) {
        synchronized (safCacheLock) {
            String uriString = treeUri.toString();
            if (!uriString.equals(cachedTreeUri) || !ownerKey.equals(cachedOwnerKey)) {
                cachedTreeUri = uriString;
                cachedOwnerKey = ownerKey;
                cachedSafEntries = new HashMap<>();
            }
            cachedScopeDocId = scopeDocId;
            if (cachedSafEntries == null) {
                cachedSafEntries = new HashMap<>();
            }
            cachedSafEntries.put(name, entry);
        }
    }

    private void removeSafCacheEntry(Uri treeUri, String ownerKey, String name) {
        synchronized (safCacheLock) {
            if (treeUri.toString().equals(cachedTreeUri)
                && ownerKey.equals(cachedOwnerKey)
                && cachedSafEntries != null) {
                cachedSafEntries.remove(name);
            }
        }
    }

    private Uri savedTreeUri() {
        String raw = prefs().getString(KEY_TREE_URI, null);
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        try {
            return Uri.parse(raw);
        } catch (RuntimeException error) {
            return null;
        }
    }

    private void saveTreeUri(Uri treeUri) {
        prefs().edit().putString(KEY_TREE_URI, treeUri.toString()).apply();
    }

    private void clearTreeUri() {
        prefs().edit().remove(KEY_TREE_URI).apply();
    }

    private void releaseTreePermission(Uri treeUri) {
        try {
            getContext().getContentResolver().releasePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // Permission may already be revoked.
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private String formatTreeLabel(Uri treeUri, boolean available) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            if (docId != null && !docId.isEmpty()) {
                int colon = docId.indexOf(':');
                if (colon >= 0) {
                    String volume = docId.substring(0, colon);
                    String relative = docId.substring(colon + 1);
                    if ("primary".equalsIgnoreCase(volume)) {
                        return relative.isEmpty() ? "内部存储" : relative;
                    }
                    return relative.isEmpty() ? volume : volume + "/" + relative;
                }
                return docId;
            }
        } catch (IllegalArgumentException ignored) {
            // Fall back to display name query below.
        }
        if (available) {
            try {
                String docId = DocumentsContract.getTreeDocumentId(treeUri);
                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                try (Cursor cursor = getContext().getContentResolver().query(
                    docUri,
                    new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                    null,
                    null,
                    null
                )) {
                    if (cursor != null && cursor.moveToFirst()) {
                        String name = cursor.getString(0);
                        if (name != null && !name.isEmpty()) {
                            return name;
                        }
                    }
                }
            } catch (RuntimeException ignored) {
                // Fall back to generic label.
            }
        }
        return "已选目录";
    }

    private File privateScopeDir(String ownerKey) {
        return new File(getContext().getNoBackupFilesDir(), "inyue-media/" + ownerKey);
    }

    private File legacyCacheDir(String legacyScope) {
        return new File(getContext().getCacheDir(), "inyue-media/" + legacyScope);
    }

    private File tempDir() {
        return new File(getContext().getCacheDir(), "inyue-media-tmp");
    }

    private void cleanTempDir() {
        File dir = tempDir();
        for (File file : files(dir)) {
            file.delete();
        }
    }

    private File shareDir() {
        return new File(getContext().getCacheDir(), "inyue-share");
    }

    private void pruneShareDir() {
        File dir = shareDir();
        File[] children = dir.listFiles();
        if (children == null || children.length == 0) {
            return;
        }
        long cutoff = System.currentTimeMillis() - SHARE_TTL_MS;
        Arrays.sort(children, Comparator.comparingLong(File::lastModified));
        int remaining = children.length;
        for (File child : children) {
            if (child.lastModified() < cutoff || remaining > SHARE_MAX_ENTRIES) {
                deleteDirectory(child);
                remaining--;
            }
        }
    }

    private static String ownerKey(String owner) {
        if (owner == null || owner.isEmpty() || owner.length() > 256) {
            return null;
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(owner.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(32);
            for (int index = 0; index < 16; index++) {
                hex.append(String.format(Locale.ROOT, "%02x", hash[index]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            return null;
        }
    }

    private static boolean validId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    private static boolean validKind(String kind) {
        return "audio".equals(kind) || "cover".equals(kind);
    }

    private static int maxBytes(String kind) {
        return ("audio".equals(kind) ? 15 : 1) * 1024 * 1024;
    }

    private static boolean usableSize(long length, String kind) {
        return length > 0 && length <= maxBytes(kind);
    }

    private static String extension(String kind, String type) {
        if (type == null) return null;
        String mime = type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if ("audio".equals(kind)) return "audio/mpeg".equals(mime) ? ".mp3" : null;
        return switch (mime) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/webp" -> ".webp";
            default -> null;
        };
    }

    private static String mimeType(String extension) {
        return switch (extension) {
            case ".mp3" -> "audio/mpeg";
            case ".jpg" -> "image/jpeg";
            case ".png" -> "image/png";
            case ".webp" -> "image/webp";
            default -> "application/octet-stream";
        };
    }

    private static String kindOfFileName(String name) {
        if (name.startsWith("audio-") && name.endsWith(".mp3")) {
            String id = name.substring(6, name.length() - 4);
            return validId(id) ? "audio" : null;
        }
        if (name.startsWith("cover-")) {
            for (String ext : COVERS) {
                if (name.endsWith(ext)) {
                    String id = name.substring(6, name.length() - ext.length());
                    return validId(id) ? "cover" : null;
                }
            }
        }
        return null;
    }

    private static String extensionOfFileName(String name) {
        if (name.endsWith(".mp3")) return ".mp3";
        for (String ext : COVERS) {
            if (name.endsWith(ext)) return ext;
        }
        return null;
    }

    private static SafEntry cachedSaf(Map<String, SafEntry> entries, String kind, String id) {
        for (String extension : "audio".equals(kind) ? AUDIO : COVERS) {
            SafEntry entry = entries.get(kind + "-" + id + extension);
            if (entry != null && usableSize(entry.size, kind)) {
                return entry;
            }
        }
        return null;
    }

    private static File cachedFile(File directory, String kind, String id) {
        for (String extension : "audio".equals(kind) ? AUDIO : COVERS) {
            File file = new File(directory, kind + "-" + id + extension);
            if (file.isFile() && usableSize(file.length(), kind)) {
                return file;
            }
        }
        return null;
    }

    private static File[] files(File directory) {
        File[] list = directory.listFiles(File::isFile);
        return list == null ? new File[0] : list;
    }

    private static void commitFile(File source, File target) throws IOException {
        if (target.exists()) {
            target.delete();
        }
        if (source.renameTo(target)) {
            return;
        }
        try (InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(target)) {
            copyStream(input, output);
        } catch (IOException error) {
            target.delete();
            throw error;
        }
        source.delete();
    }

    private static void copyStream(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[32 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
        output.flush();
    }

    private static void deleteDirectory(File directory) {
        if (directory == null || !directory.exists()) {
            return;
        }
        File[] children = directory.listFiles();
        if (children != null) {
            for (File child : children) {
                if (child.isDirectory()) {
                    deleteDirectory(child);
                } else {
                    child.delete();
                }
            }
        }
        directory.delete();
    }

    private static void deleteDirectoryIfEmpty(File directory) {
        if (directory == null || !directory.isDirectory()) {
            return;
        }
        String[] children = directory.list();
        if (children != null && children.length == 0) {
            directory.delete();
        }
    }

    private static void prunePrivate(File directory, long incoming) {
        File[] list = directory.listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
        if (list == null) return;
        Arrays.sort(list, Comparator.comparingLong(File::lastModified));
        long used = incoming;
        for (File file : list) used += file.length();
        for (File file : list) {
            if (used <= PRIVATE_QUOTA) break;
            long bytes = file.length();
            if (file.delete()) used -= bytes;
        }
    }
}
