package com.tingyuan.inyue;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "OfflineMedia")
public class OfflineMediaPlugin extends Plugin {
    private static final long MAX_AGE = 30L * 24 * 60 * 60 * 1000;
    private static final long QUOTA = 256L * 1024 * 1024;
    private static final Pattern ID = Pattern.compile("[a-f0-9-]{36}");
    private static final String[] AUDIO = { ".mp3" };
    private static final String[] COVERS = { ".jpg", ".png", ".webp" };
    private final ExecutorService writes = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnDestroy() {
        writes.shutdown();
    }

    @PluginMethod
    public void read(PluginCall call) {
        File directory = scope(call);
        String kind = call.getString("kind");
        String id = call.getString("id");
        if (directory == null || !validKind(kind) || !validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        File file = cached(directory, kind, id);
        JSObject result = new JSObject();
        if (file != null) {
            file.setLastModified(System.currentTimeMillis());
            result.put("uri", Uri.fromFile(file).toString());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void listAudio(PluginCall call) {
        File directory = scope(call);
        if (directory == null) {
            call.reject("Invalid media scope");
            return;
        }
        JSObject sources = new JSObject();
        for (File file : files(directory)) {
            String name = file.getName();
            if (!name.startsWith("audio-") || !name.endsWith(".mp3")) continue;
            String id = name.substring(6, name.length() - 4);
            if (validId(id) && usable(file, "audio")) sources.put(id, Uri.fromFile(file).toString());
        }
        call.resolve(new JSObject().put("sources", sources));
    }

    @PluginMethod
    public void download(PluginCall call) {
        File directory = scope(call);
        String kind = call.getString("kind");
        String id = call.getString("id");
        if (directory == null || !validKind(kind) || !validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        writes.execute(() -> {
            try {
                save(directory, kind, id, call);
                call.resolve();
            } catch (IOException | IllegalArgumentException error) {
                call.reject("Unable to cache media");
            }
        });
    }

    @PluginMethod
    public void removeAudio(PluginCall call) {
        File directory = scope(call);
        String id = call.getString("id");
        if (directory == null || !validId(id)) {
            call.reject("Invalid media key");
            return;
        }
        writes.execute(() -> {
            new File(directory, "audio-" + id + ".mp3").delete();
            call.resolve();
        });
    }

    @PluginMethod
    public void clean(PluginCall call) {
        File directory = scope(call);
        if (directory == null) {
            call.reject("Invalid media scope");
            return;
        }
        boolean removeScope = Boolean.TRUE.equals(call.getBoolean("removeScope", false));
        writes.execute(() -> {
            for (File file : files(directory)) {
                if (removeScope || file.getName().endsWith(".part")) file.delete();
            }
            if (removeScope) directory.delete();
            else prune(directory, 0);
            call.resolve();
        });
    }

    private void save(File directory, String kind, String id, PluginCall call) throws IOException {
        File existing = cached(directory, kind, id);
        if (existing != null) {
            existing.setLastModified(System.currentTimeMillis());
            return;
        }
        URI source = URI.create(call.getString("url", ""));
        URI origin = URI.create(call.getString("origin", ""));
        boolean local = "http".equals(source.getScheme()) && "127.0.0.1".equals(source.getHost())
            && (source.getPort() == 8794 || source.getPort() == 5223);
        if ((!local && !"https".equals(source.getScheme())) || source.getHost() == null
            || source.getUserInfo() != null || source.getFragment() != null
            || !source.getScheme().equals(origin.getScheme())
            || !source.getRawAuthority().equals(origin.getRawAuthority())
            || !source.getRawPath().matches("/api/media/[a-f0-9-]{36}") || source.getRawQuery() == null) {
            throw new IOException("Invalid media source");
        }
        if (!directory.mkdirs() && !directory.isDirectory()) throw new IOException("Missing cache directory");
        HttpURLConnection request = (HttpURLConnection) source.toURL().openConnection();
        request.setConnectTimeout(5000);
        request.setReadTimeout(10000);
        request.setInstanceFollowRedirects(false);
        request.setUseCaches(false);
        request.setRequestProperty("Accept-Encoding", "identity");
        File partial = null;
        try {
            if (request.getResponseCode() != HttpURLConnection.HTTP_OK || request.getHeaderField("Content-Range") != null)
                throw new IOException("Invalid media response");
            String extension = extension(kind, request.getContentType());
            int length = request.getContentLength();
            int limit = maxBytes(kind);
            if (extension == null || length == 0 || length > limit) throw new IOException("Invalid media headers");
            partial = File.createTempFile("download-", ".part", directory);
            int bytes = 0;
            try (var input = request.getInputStream(); var output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    bytes += count;
                    if (bytes > limit || (length >= 0 && bytes > length)) throw new IOException("Media too large");
                    output.write(buffer, 0, count);
                }
            }
            if (bytes == 0 || (length >= 0 && bytes != length)) throw new IOException("Incomplete media");
            prune(directory, bytes);
            File file = new File(directory, kind + "-" + id + extension);
            if (!partial.renameTo(file)) throw new IOException("Unable to commit media");
            file.setLastModified(System.currentTimeMillis());
        } finally {
            request.disconnect();
            if (partial != null) partial.delete();
        }
    }

    private File scope(PluginCall call) {
        String scope = call.getString("scope");
        return validId(scope) ? new File(getContext().getCacheDir(), "inyue-media/" + scope) : null;
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

    private static File[] files(File directory) {
        File[] files = directory.listFiles(File::isFile);
        return files == null ? new File[0] : files;
    }

    private static boolean usable(File file, String kind) {
        long length = file.length();
        return length > 0 && length <= maxBytes(kind) && file.lastModified() > System.currentTimeMillis() - MAX_AGE;
    }

    private static File cached(File directory, String kind, String id) {
        for (String extension : "audio".equals(kind) ? AUDIO : COVERS) {
            File file = new File(directory, kind + "-" + id + extension);
            if (usable(file, kind)) return file;
        }
        return null;
    }

    private static void prune(File directory, long incoming) {
        File[] files = directory.listFiles(file -> file.isFile() && !file.getName().endsWith(".part"));
        if (files == null) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        long used = incoming;
        for (File file : files) used += file.length();
        long oldest = System.currentTimeMillis() - MAX_AGE;
        for (File file : files) {
            if (used <= QUOTA && file.lastModified() > oldest) break;
            long bytes = file.length();
            if (file.delete()) used -= bytes;
        }
    }
}
