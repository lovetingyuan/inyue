import { shallowRef } from "vue";
import { Capacitor } from "@capacitor/core";
import { useAppStore } from "~/stores/app";
import { useSessionStore } from "~/stores/session";
import { useMusicApi } from "~/composables/useMusicApi";
import { libraryError, responseStatus } from "~/utils/library-error";
import { sanitizeSongFilename, triggerBrowserDownload } from "~/utils/song-download";
import type { MediaAuthorization, Song } from "~~/shared/types/library";

export function useSongDownload() {
  const app = useAppStore();
  const session = useSessionStore();
  const { apiOrigin, request } = useMusicApi();
  const downloadingIds = shallowRef(new Set<string>());

  function setDownloading(id: string, active: boolean) {
    const next = new Set(downloadingIds.value);
    if (active) {
      next.add(id);
    } else {
      next.delete(id);
    }
    downloadingIds.value = next;
  }

  function isDownloading(id: string) {
    return downloadingIds.value.has(id);
  }

  async function authorizeAudioUrl(songId: string) {
    const { _data } = await request<MediaAuthorization>("/api/media/authorize", {
      method: "POST",
      body: { songIds: [songId] },
    });
    const track = _data?.tracks.find(({ id }) => id === songId);
    if (!track?.url) {
      throw new Error("找不到歌曲音频文件。");
    }
    return track.url;
  }

  async function download(song: Pick<Song, "id" | "title">) {
    if (downloadingIds.value.has(song.id)) {
      return;
    }
    setDownloading(song.id, true);
    try {
      const scope = session.offlineScope;
      if (Capacitor.isNativePlatform()) {
        const { exportNativeAudio, readOfflineMedia } = await import("~/utils/offline-media");
        const cached = scope ? await readOfflineMedia(scope, "audio", song.id) : undefined;
        let url: string | undefined;
        let origin: string | undefined;
        if (!cached) {
          if (app.offline) {
            app.showToast("歌曲尚未缓存，无法离线下载", { tone: "warning" });
            return;
          }
          url = await authorizeAudioUrl(song.id);
          origin = apiOrigin() || location.origin;
        }
        const fileName = sanitizeSongFilename(song.title, "audio/mpeg");
        const result = await exportNativeAudio({
          scope,
          id: song.id,
          fileName,
          url,
          origin,
        });
        if (!result.canceled) {
          const savedName = result.fileName || fileName;
          const target = result.directory ? `${result.directory}/${savedName}` : savedName;
          app.showToast(`已保存到 ${target}`, {
            tone: "success",
            action: result.directory
              ? {
                  label: "打开目录",
                  onClick: async () => {
                    try {
                      const { openNativeDownloads } = await import("~/utils/offline-media");
                      await openNativeDownloads();
                    } catch {
                      app.showToast("无法打开下载目录", { tone: "error" });
                    }
                  },
                }
              : undefined,
          });
        }
        return;
      }

      if (scope) {
        const { readOfflineMedia } = await import("~/utils/offline-media");
        const cached = await readOfflineMedia(scope, "audio", song.id);
        if (cached instanceof Blob) {
          triggerBrowserDownload(cached, sanitizeSongFilename(song.title, cached.type));
          return;
        }
      }

      if (app.offline) {
        app.showToast("歌曲尚未缓存，无法离线下载", { tone: "warning" });
        return;
      }

      const url = await authorizeAudioUrl(song.id);
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error("下载歌曲失败，请稍后重试。");
      }
      const contentType = response.headers.get("content-type");
      const blob = await response.blob();
      triggerBrowserDownload(blob, sanitizeSongFilename(song.title, contentType || blob.type));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return;
      }
      const message =
        responseStatus(cause) !== undefined
          ? libraryError(cause)
          : cause instanceof Error && cause.message
            ? cause.message
            : "下载歌曲失败，请稍后重试。";
      app.showToast(message, { tone: "error" });
    } finally {
      setDownloading(song.id, false);
    }
  }

  return {
    downloadingIds,
    isDownloading,
    download,
  };
}
