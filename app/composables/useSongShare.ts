import { ref } from "vue";
import { Capacitor } from "@capacitor/core";
import { useAppStore } from "~/stores/app";
import { useSessionStore } from "~/stores/session";
import { useMusicApi } from "~/composables/useMusicApi";
import { libraryError, responseStatus } from "~/utils/library-error";
import { sanitizeSongFilename } from "~/utils/song-download";
import type { MediaAuthorization, Song } from "~~/shared/types/library";

interface UseSongShareOptions {
  fallbackDownload?: (song: Song) => void | Promise<void>;
}

function formatSongShareText(song: Song) {
  return song.artist ? `${song.title} - ${song.artist}` : song.title;
}

function supportsWebAudioShare() {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function"
  ) {
    return false;
  }
  try {
    return navigator.canShare({
      files: [new File([], "song.mp3", { type: "audio/mpeg" })],
    });
  } catch {
    return false;
  }
}

function buildWebShareData(song: Song, file: File) {
  const summary = formatSongShareText(song);
  const candidates: ShareData[] = [
    { files: [file], title: song.title, text: summary },
    { files: [file], title: song.title },
    { files: [file] },
  ];
  return candidates.find((candidate) => {
    try {
      return navigator.canShare(candidate);
    } catch {
      return false;
    }
  });
}

function isShareCanceled(cause: unknown, native: boolean) {
  return (
    (cause instanceof DOMException && cause.name === "AbortError") ||
    (native && cause instanceof Error && cause.message === "Share canceled")
  );
}

export function useSongShare(options: UseSongShareOptions = {}) {
  const app = useAppStore();
  const session = useSessionStore();
  const { apiOrigin, request } = useMusicApi();
  const sharingId = ref<string | null>(null);

  function isSharing(id: string) {
    return sharingId.value === id;
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

  function notifyUnsupportedWebShare(song: Song) {
    app.showToast("当前浏览器不支持直接分享音频文件", {
      tone: "warning",
      action: options.fallbackDownload
        ? {
            label: "下载",
            onClick: () => options.fallbackDownload?.(song),
          }
        : undefined,
    });
  }

  async function resolveWebAudioBlob(song: Song, scope?: string) {
    if (scope) {
      const { readOfflineMedia } = await import("~/utils/offline-media");
      const cached = await readOfflineMedia(scope, "audio", song.id);
      if (cached instanceof Blob) {
        return { blob: cached, contentType: cached.type };
      }
    }

    if (app.offline) {
      app.showToast("歌曲尚未缓存，无法离线分享", { tone: "warning" });
      return undefined;
    }

    const url = await authorizeAudioUrl(song.id);
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error("获取歌曲音频失败，请稍后重试。");
    }
    const contentType = response.headers.get("content-type");
    const blob = await response.blob();
    return { blob, contentType: contentType || blob.type };
  }

  async function share(song: Song) {
    if (sharingId.value) {
      return;
    }
    const native = Capacitor.isNativePlatform();
    if (!native && !supportsWebAudioShare()) {
      notifyUnsupportedWebShare(song);
      return;
    }

    sharingId.value = song.id;
    try {
      const scope = session.offlineScope;
      if (native) {
        const { prepareNativeShareAudio, readOfflineMedia } = await import("~/utils/offline-media");
        const cached = scope ? await readOfflineMedia(scope, "audio", song.id) : undefined;
        let url: string | undefined;
        let origin: string | undefined;
        if (!cached) {
          if (app.offline) {
            app.showToast("歌曲尚未缓存，无法离线分享", { tone: "warning" });
            return;
          }
          url = await authorizeAudioUrl(song.id);
          origin = apiOrigin() || location.origin;
        }
        const fileName = sanitizeSongFilename(song.title, "audio/mpeg");
        const prepared = await prepareNativeShareAudio({
          scope,
          id: song.id,
          fileName,
          url,
          origin,
        });
        const { Share } = await import("@capacitor/share");
        await Share.share({
          title: song.title,
          text: formatSongShareText(song),
          files: [prepared.uri],
          dialogTitle: "分享歌曲",
        });
        return;
      }

      const resolved = await resolveWebAudioBlob(song, scope);
      if (!resolved) {
        return;
      }
      const mimeType =
        resolved.contentType?.split(";", 1)[0]?.trim().toLowerCase() || "audio/mpeg";
      const fileName = sanitizeSongFilename(song.title, mimeType);
      const file = new File([resolved.blob], fileName, { type: mimeType });
      const shareData = buildWebShareData(song, file);
      if (!shareData) {
        notifyUnsupportedWebShare(song);
        return;
      }

      try {
        await navigator.share(shareData);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "NotAllowedError") {
          app.showToast("歌曲文件已准备好", {
            tone: "info",
            duration: 8000,
            action: {
              label: "立即分享",
              onClick: async () => {
                try {
                  await navigator.share(shareData);
                } catch (retryCause) {
                  if (isShareCanceled(retryCause, false)) {
                    return;
                  }
                  app.showToast("分享歌曲失败，请稍后重试。", { tone: "error" });
                }
              },
            },
          });
          return;
        }
        throw cause;
      }
    } catch (cause) {
      if (isShareCanceled(cause, native)) {
        return;
      }
      const message =
        responseStatus(cause) !== undefined
          ? libraryError(cause)
          : cause instanceof Error && cause.message
            ? cause.message
            : "分享歌曲失败，请稍后重试。";
      app.showToast(message, { tone: "error" });
    } finally {
      sharingId.value = null;
    }
  }

  return {
    sharingId,
    isSharing,
    share,
  };
}
