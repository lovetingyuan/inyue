package com.tingyuan.inyue;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.dwbn.plugins.playlist.PlaylistRuntime;
import org.dwbn.plugins.playlist.data.AudioTrack;
import org.dwbn.plugins.playlist.manager.PlaybackProgress;
import org.dwbn.plugins.playlist.manager.PlaylistManager;

@CapacitorPlugin(name = "PlaybackProgress")
public class PlaybackProgressPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void getProgress(PluginCall call) {
        mainHandler.post(() -> {
            PlaylistManager manager = PlaylistRuntime.getPlaylistManager(getContext());
            AudioTrack track = manager.getCurrentItem();
            PlaybackProgress progress = manager.getCurrentProgress();
            JSObject sample = new JSObject();
            if (track != null && progress != null) {
                sample.put("trackId", track.getTrackId());
                sample.put("position", progress.getPosition() / 1000.0);
            }
            call.resolve(sample);
        });
    }
}
