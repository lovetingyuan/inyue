import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import { useMusicApi } from "~/composables/useMusicApi";
import { releaseCoverObjectUrl, retainCoverObjectUrl } from "~/utils/cover-object-urls";
import { computed, ref, shallowRef, watch } from "vue";
import type { PluginListenerHandle } from "@capacitor/core";
import type { PlaylistPlugin, RepeatMode } from "@dwbn/capacitor-plugin-playlist";
import {
  useDocumentVisibility,
  useEventListener,
  useIntervalFn,
  useThrottleFn,
} from "@vueuse/core";
import { defineStore } from "pinia";
import type {
  PlaybackMode,
  PlaybackSnapshot,
  Song,
  SongDetails,
  Track,
} from "~~/shared/types/library";

interface PlayOptions {
  queueKey?: string;
  seedSongs?: Song[];
  needsFullQueue?: boolean;
}

export const usePlayerStore = defineStore("player", () => {
  const { apiOrigin, mediaUrl, native, request } = useMusicApi();
  const app = useAppStore();
  const session = useSessionStore();
  const visibility = useDocumentVisibility();
  const tracks = shallowRef<Track[]>([]);
  const ids = ref<string[]>([]);
  const order = ref<string[]>([]);
  const queueSource = ref("");
  const id = ref("");
  const position = ref(0);
  const sampledPosition = ref<number>();
  const mode = ref<PlaybackMode>("sequential");
  const volume = ref(1);
  const playing = ref(false);
  const loading = ref(false);
  const error = ref("");
  const pendingTrack = shallowRef<Omit<Track, "url">>();
  const currentArtwork = shallowRef<{
    trackId: string;
    scope: string;
    coverId: string;
    url: string;
  }>();
  const current = computed(() => {
    const track = pendingTrack.value ?? tracks.value.find((item) => item.id === id.value);
    const artwork = currentArtwork.value;
    return track && artwork?.trackId === track.id && artwork.coverId === track.coverId
      ? { ...track, coverUrl: artwork.url }
      : track;
  });
  const queue = computed(() => {
    const byId = new Map(tracks.value.map((track) => [track.id, track]));
    return order.value.flatMap((trackId) => byId.get(trackId) ?? []);
  });
  let player: PlaylistPlugin | undefined;
  let listener: PluginListenerHandle | undefined;
  let nativeProgress:
    | { getProgress(): Promise<{ trackId?: string; position?: number }> }
    | undefined;
  let nativeRead: Promise<void> | undefined;
  let nativeQueueSynced = false;
  const nativeLoadTarget = ref("");
  const nativeSeeking = ref(false);
  let audio: HTMLAudioElement | undefined;
  let webPlayback: Promise<void> | undefined;
  let owner = "";
  let requestedOwner = "";
  let ownerRevision = 0;
  let operations = Promise.resolve();
  let selection: AbortController | undefined;
  let queueSync: AbortController | undefined;
  let mediaWrites: AbortController | undefined;
  let audioUrl: string | undefined;
  let nativeResumeAfterError = false;
  const cachingTracks = new Set<string>();

  function abortQueueSync() {
    queueSync?.abort();
    queueSync = undefined;
  }

  function readNativeProgress() {
    if (nativeRead) {
      return nativeRead;
    }
    if (
      !nativeProgress ||
      visibility.value !== "visible" ||
      !id.value ||
      owner !== requestedOwner ||
      pendingTrack.value ||
      nativeLoadTarget.value ||
      nativeSeeking.value
    ) {
      return;
    }
    const trackId = id.value;
    const revision = ownerRevision;
    const read = nativeProgress
      .getProgress()
      .then((sample) => {
        if (nativeRead !== read || revision !== ownerRevision || trackId !== id.value) {
          return;
        }
        sampledPosition.value = sample.trackId === trackId ? sample.position : undefined;
      })
      .catch(() => {
        if (nativeRead === read) {
          sampledPosition.value = undefined;
        }
      })
      .finally(() => {
        if (nativeRead === read) {
          nativeRead = undefined;
        }
      });
    nativeRead = read;
    return read;
  }

  function sampleProgress() {
    if (native) {
      return Boolean(readNativeProgress());
    }
    if (
      !playing.value ||
      !audio ||
      visibility.value !== "visible" ||
      !id.value ||
      owner !== requestedOwner ||
      pendingTrack.value
    ) {
      return false;
    }
    sampledPosition.value = audio.currentTime;
    return true;
  }

  const { pause: stopProgressSampling, resume: startProgressSampling } = useIntervalFn(
    sampleProgress,
    100,
    { immediate: false },
  );
  watch(
    [id, playing, pendingTrack, visibility, nativeLoadTarget, nativeSeeking],
    () => {
      nativeRead = undefined;
      sampledPosition.value = undefined;
      stopProgressSampling();
      if (sampleProgress() && playing.value) {
        startProgressSampling();
      }
    },
    { flush: "sync" },
  );

  function storageKey(userId: string) {
    return `music-playback:${userId}`;
  }

  function playbackSnapshot(): PlaybackSnapshot {
    return {
      ids: ids.value,
      order: order.value,
      id: id.value,
      position: position.value,
      mode: mode.value,
      volume: volume.value,
      queueKey: queueSource.value,
    };
  }

  function persistPlaybackSnapshot() {
    if (!import.meta.client || !owner || owner !== requestedOwner || !ids.value.length) {
      return;
    }
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(playbackSnapshot()));
    } catch {
      /* Storage may be unavailable. */
    }
  }

  const persistPosition = useThrottleFn(persistPlaybackSnapshot, 2500, true, true);

  watch([ids, order, queueSource, id, mode, volume], persistPlaybackSnapshot);
  watch(position, () => {
    persistPosition();
  });
  watch(playing, (isPlaying) => {
    if (!isPlaying) {
      persistPlaybackSnapshot();
    }
  });
  if (import.meta.client) {
    watch(visibility, (state) => {
      if (state === "hidden") {
        persistPlaybackSnapshot();
      }
    });
    useEventListener("pagehide", persistPlaybackSnapshot);
  }

  function playbackError() {
    playing.value = false;
    loading.value = false;
    error.value = app.offline
      ? "这首歌曲尚未缓存，联网后可播放。"
      : "无法播放，请检查网络或登录状态，再刷新队列。";
  }

  function replaceArtwork(next?: { trackId: string; scope: string; coverId: string; url: string }) {
    const previous = currentArtwork.value;
    currentArtwork.value = next;
    if (previous) {
      releaseCoverObjectUrl(previous.scope, previous.coverId);
    }
  }

  function releaseObjectUrls() {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = undefined;
    }
    replaceArtwork();
  }

  function isNativeLocalUri(url: string) {
    return url.startsWith("file://") || url.startsWith("content://");
  }

  function mediaUrlIsFresh(url: string) {
    try {
      const source = new URL(url);
      if (!/^\/api\/media\/[\da-f-]{36}$/.test(source.pathname)) {
        return false;
      }
      if (!native) {
        return source.origin === location.origin;
      }
      const expires = Number(source.searchParams.get("expires"));
      return Number.isFinite(expires) && expires > Date.now() + 30_000;
    } catch {
      return false;
    }
  }

  function isUsableCoverUrl(url: string | null | undefined): url is string {
    if (!url) {
      return false;
    }
    return native ? isNativeLocalUri(url) || mediaUrlIsFresh(url) : mediaUrlIsFresh(url);
  }

  function resolveRemoteAudioUrl(track: Pick<Track, "audioId" | "url">) {
    if (app.offline) {
      return "";
    }
    if (track.audioId) {
      return mediaUrl(track.audioId);
    }
    return track.url && !isNativeLocalUri(track.url) && mediaUrlIsFresh(track.url) ? track.url : "";
  }

  function resolveRemoteCoverUrl(track: Pick<Track, "coverId" | "coverUrl">) {
    if (app.offline) {
      return null;
    }
    if (track.coverId) {
      return mediaUrl(track.coverId) || null;
    }
    return isUsableCoverUrl(track.coverUrl) && !isNativeLocalUri(track.coverUrl)
      ? track.coverUrl
      : null;
  }

  function toBaseTrack(song: Omit<Track, "url" | "coverUrl">, coverUrl: string | null = null) {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      year: song.year,
      lyrics: song.lyrics ?? null,
      duration: song.duration,
      audioId: song.audioId,
      coverId: song.coverId,
      coverUrl,
    };
  }

  async function lookupSongs(list: string[], signal?: AbortSignal) {
    const found: Song[] = [];
    for (let index = 0; index < list.length; index += 80) {
      if (signal?.aborted || app.offline) {
        break;
      }
      const { _data } = await request<{ items: Song[] }>("/api/songs/lookup", {
        method: "POST",
        body: { ids: list.slice(index, index + 80) },
        signal,
        timeout: 5000,
      });
      found.push(...(_data?.items ?? []));
    }
    return found;
  }

  async function fetchSongMetadata(trackId: string, signal?: AbortSignal) {
    if (app.offline || signal?.aborted) {
      return undefined;
    }
    const { _data } = await request<SongDetails>(`/api/songs/${trackId}`, {
      signal,
      timeout: 5000,
    }).catch(() => ({ _data: undefined }));
    const scope = session.offlineScope;
    if (_data && scope && !signal?.aborted) {
      void import("~/utils/offline-library").then(({ saveOfflineSongs }) =>
        saveOfflineSongs(scope, [_data]).catch(() => undefined),
      );
    }
    return _data;
  }

  async function cachePlayingTrack(track: Track) {
    const scope = session.offlineScope;
    const signal = mediaWrites?.signal;
    if (!scope || !signal || app.offline || audioUrl || !track.url || isNativeLocalUri(track.url)) {
      return;
    }
    const key = `${scope}/${track.id}`;
    if (cachingTracks.has(key)) {
      return;
    }
    cachingTracks.add(key);
    try {
      const [{ cacheOfflineMedia }, { readOfflineSong, saveOfflineSongs }] = await Promise.all([
        import("~/utils/offline-media"),
        import("~/utils/offline-library"),
      ]);
      if (signal.aborted || app.offline) {
        return;
      }
      const origin = apiOrigin();
      const audioCache = cacheOfflineMedia(scope, "audio", track.id, track.url, signal, origin);
      if (!signal.aborted && !(await readOfflineSong(scope, track.id))) {
        const { _data } = await request<SongDetails>(`/api/songs/${track.id}`, { signal });
        if (_data && !signal.aborted) {
          await saveOfflineSongs(scope, [_data]);
        }
      }
      if (track.coverId && track.coverUrl && !isNativeLocalUri(track.coverUrl)) {
        void cacheOfflineMedia(scope, "cover", track.coverId, track.coverUrl, signal, origin);
      }
      await audioCache;
      if (native && !signal.aborted && track.id !== id.value) {
        promoteNativeCache(track.id);
      }
    } finally {
      cachingTracks.delete(key);
    }
  }

  function nativeItem({ id, url, title, artist, album, coverUrl }: Track) {
    return {
      trackId: id,
      assetUrl: url,
      title,
      artist,
      album: album ?? "",
      albumArt: coverUrl ?? undefined,
    };
  }

  async function nativeCachedTrack(track: Track) {
    const scope = session.offlineScope;
    if (!scope) {
      return;
    }
    const { readOfflineMedia } = await import("~/utils/offline-media");
    const url = await readOfflineMedia(scope, "audio", track.id);
    if (typeof url !== "string") {
      return;
    }
    const cover = track.coverId ? await readOfflineMedia(scope, "cover", track.coverId) : undefined;
    const fallbackCover = isUsableCoverUrl(track.coverUrl)
      ? track.coverUrl
      : resolveRemoteCoverUrl(track);
    return { ...track, url, coverUrl: typeof cover === "string" ? cover : fallbackCover };
  }

  function promoteNativeCache(trackId: string) {
    const revision = ownerRevision;
    operations = operations
      .then(async () => {
        const output = player;
        if (!output || !nativeQueueSynced || revision !== ownerRevision || trackId === id.value) {
          return;
        }
        const track = tracks.value.find((item) => item.id === trackId);
        if (!track || isNativeLocalUri(track.url)) {
          return;
        }
        const cached = await nativeCachedTrack(track);
        if (!cached || revision !== ownerRevision || trackId === id.value) {
          return;
        }
        await output.replaceItem({ id: trackId, item: nativeItem(cached) });
        tracks.value = tracks.value.map((item) => (item.id === trackId ? cached : item));
      })
      .catch(() => undefined);
  }

  async function initializeNative() {
    if (player) {
      return;
    }
    const { Playlist, RmxAudioStatusMessage: eventType } =
      await import("@dwbn/capacitor-plugin-playlist");
    await Playlist.initialize();
    player = Playlist;
    listener = await Playlist.addListener("status", ({ status }) => {
      if (owner !== requestedOwner) {
        return;
      }
      if (
        status.msgType === eventType.RMXSTATUS_ERROR ||
        status.msgType === eventType.RMXSTATUS_STALLED
      ) {
        nativeResumeAfterError ||= playing.value || loading.value;
        const track = tracks.value.find((item) => item.id === status.trackId);
        if (track && isNativeLocalUri(track.url) && !app.offline) {
          const time = track.id === id.value ? (sampledPosition.value ?? position.value) : 0;
          void run(async () => {
            if (await nativeCachedTrack(track)) {
              playbackError();
            } else {
              await load(track.id, time, true);
            }
          });
          return;
        }
        playbackError();
        return;
      }
      if (status.msgType === eventType.RMXSTATUS_STOPPED) {
        loading.value = false;
      }
      if (status.value && "currentPosition" in status.value) {
        // Android can report the first track while replacing the native queue.
        if (nativeLoadTarget.value && status.trackId !== nativeLoadTarget.value) {
          return;
        }
        const previous = id.value;
        if (order.value.includes(status.trackId)) {
          id.value = status.trackId;
        }
        if (previous && previous !== id.value) {
          promoteNativeCache(previous);
        }
        position.value = status.value.currentPosition;
        playing.value = status.value.status === "playing";
        loading.value = status.value.status === "loading";
        if (
          status.msgType === eventType.RMXSTATUS_PLAYING ||
          status.msgType === eventType.RMXSTATUS_PAUSE
        ) {
          nativeResumeAfterError = false;
        }
        if (status.msgType === eventType.RMXSTATUS_PLAYING) {
          const track = tracks.value.find((item) => item.id === status.trackId);
          if (track && isNativeLocalUri(track.url)) {
            const revision = ownerRevision;
            void nativeCachedTrack(track)
              .then((cached) => {
                if (
                  cached &&
                  revision === ownerRevision &&
                  cached.coverUrl &&
                  cached.coverUrl !== track.coverUrl
                ) {
                  tracks.value = tracks.value.map((item) =>
                    item.id === track.id ? { ...item, coverUrl: cached.coverUrl } : item,
                  );
                }
              })
              .catch(() => undefined);
          } else if (track) {
            void cachePlayingTrack(track).catch(() => undefined);
          }
        }
      }
    });

    const { Capacitor, registerPlugin } = await import("@capacitor/core");
    if (Capacitor.isPluginAvailable("PlaybackProgress")) {
      nativeProgress = registerPlugin<NonNullable<typeof nativeProgress>>("PlaybackProgress");
    }
  }

  function webAudio() {
    if (audio) {
      return audio;
    }
    audio = new Audio();
    audio.preload = "metadata";
    audio.ontimeupdate = () => {
      position.value = audio?.currentTime ?? 0;
    };
    audio.onplay = () => {
      playing.value = true;
    };
    audio.onpause = () => {
      if (audio) {
        position.value = audio.currentTime;
      }
      playing.value = false;
      loading.value = false;
    };
    audio.onloadstart = audio.onwaiting = () => {
      loading.value = true;
    };
    audio.oncanplay =
      audio.onemptied =
      audio.onabort =
        () => {
          loading.value = false;
        };
    audio.onplaying = () => {
      loading.value = false;
      const track = tracks.value.find((item) => item.id === id.value);
      if (track) {
        void cachePlayingTrack(track).catch(() => undefined);
      }
    };
    audio.onended = () => {
      if (!pendingTrack.value) {
        void run(() => step(1, true));
      }
    };
    audio.onerror = playbackError;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", () => {
        if (!playing.value) {
          void run(toggle);
        }
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        if (playing.value) {
          void run(toggle);
        }
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        void run(() => step(1));
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        void run(() => step(-1));
      });
      navigator.mediaSession.setActionHandler("seekto", ({ seekTime }) => {
        if (seekTime !== undefined) {
          void run(() => seek(seekTime));
        }
      });
    }
    return audio;
  }

  function playWeb(output: HTMLAudioElement) {
    // Buffering can keep play() pending while the user issues more player commands.
    const playback = output.play();
    webPlayback = playback;
    void playback.catch((cause: unknown) => {
      if (
        webPlayback !== playback ||
        (cause instanceof DOMException && cause.name === "AbortError")
      ) {
        return;
      }
      playbackError();
    });
  }

  function nativeRepeatMode(
    playbackMode: PlaybackMode = mode.value,
    count = order.value.length,
  ): RepeatMode {
    if (playbackMode === "single") {
      return "one";
    }
    if (playbackMode === "loop" && count > 1) {
      return "all";
    }
    return "off";
  }

  async function load(
    selected: string,
    time: number,
    autoplay: boolean,
    signal?: AbortSignal,
    forceNativeSync = false,
  ) {
    const track = tracks.value.find(({ id }) => id === selected);
    if (!track) {
      return;
    }
    const previous = id.value;
    if (native) {
      nativeLoadTarget.value = selected;
    }
    id.value = selected;
    if (native && previous && previous !== selected) {
      promoteNativeCache(previous);
    }
    position.value = time;
    sampledPosition.value = undefined;
    if (native) {
      try {
        nativeResumeAfterError = false;
        const revision = ownerRevision;
        let source = await nativeCachedTrack(track);
        if (!source && !app.offline) {
          let url = resolveRemoteAudioUrl(track);
          let nextTrack = track;
          if (!url && !track.audioId) {
            const fetched = await fetchSongMetadata(track.id, signal);
            if (fetched?.audioId) {
              nextTrack = { ...nextTrack, ...toBaseTrack(fetched, nextTrack.coverUrl) };
              url = mediaUrl(fetched.audioId);
            }
          }
          if (url) {
            source = { ...nextTrack, url };
          }
        }
        if (revision !== ownerRevision || signal?.aborted || owner !== requestedOwner) {
          return;
        }
        if (!source) {
          playbackError();
          return;
        }
        const coverId = source.coverId;
        const scope = session.offlineScope;
        if (coverId && !isNativeLocalUri(source.coverUrl ?? "")) {
          if (scope) {
            const { readOfflineMedia } = await import("~/utils/offline-media");
            const localCover = await readOfflineMedia(scope, "cover", coverId);
            if (revision !== ownerRevision || signal?.aborted || owner !== requestedOwner) {
              return;
            }
            if (typeof localCover === "string") {
              source = { ...source, coverUrl: localCover };
            }
          }
          if (!isUsableCoverUrl(source.coverUrl) && !app.offline) {
            const remoteCover = mediaUrl(coverId);
            if (remoteCover) {
              source = { ...source, coverUrl: remoteCover };
              if (scope) {
                const writeSignal = mediaWrites?.signal;
                const origin = apiOrigin();
                void import("~/utils/offline-media").then(({ cacheOfflineMedia }) =>
                  cacheOfflineMedia(scope, "cover", coverId, remoteCover, writeSignal, origin),
                );
              }
            }
          }
        }
        const playable = source;
        const trackChanged =
          playable.url !== track.url ||
          playable.coverUrl !== track.coverUrl ||
          playable.audioId !== track.audioId;
        if (trackChanged) {
          tracks.value = tracks.value.map((item) => (item.id === track.id ? playable : item));
        }
        await initializeNative();
        const output = player;
        if (owner !== requestedOwner || signal?.aborted || !output) {
          return;
        }
        if (!nativeQueueSynced || forceNativeSync) {
          await output.setRepeatMode({ mode: nativeRepeatMode() });
          await output.setPlaylistItems({
            items: queue.value.map(nativeItem),
            options: { startPaused: true, playFromId: selected },
          });
          await output.setPlaybackVolume({ volume: volume.value });
          nativeQueueSynced = true;
        } else if (trackChanged) {
          await output.replaceItem({ id: selected, item: nativeItem(playable) });
        }
        if (owner !== requestedOwner || signal?.aborted) {
          return;
        }
        if (autoplay) {
          await output.playTrackById({ id: selected, position: time });
        } else {
          await output.selectTrackById({ id: selected, position: time });
        }
      } finally {
        nativeLoadTarget.value = "";
      }
    } else {
      const revision = ownerRevision;
      const scope = session.offlineScope;
      let currentTrack = track;
      if (
        scope &&
        currentTrack.coverId &&
        !(
          currentArtwork.value?.trackId === currentTrack.id &&
          currentArtwork.value.scope === scope &&
          currentArtwork.value.coverId === currentTrack.coverId
        )
      ) {
        const cachedUrl = retainCoverObjectUrl(scope, currentTrack.coverId);
        if (cachedUrl) {
          replaceArtwork({
            trackId: currentTrack.id,
            scope,
            coverId: currentTrack.coverId,
            url: cachedUrl,
          });
        }
      }
      const media = scope ? await import("~/utils/offline-media") : undefined;
      const local = scope && (await media?.readOfflineMedia(scope, "audio", currentTrack.id));
      let source = local ? "" : resolveRemoteAudioUrl(currentTrack);
      if (!local && !source && !app.offline && !currentTrack.audioId) {
        const fetched = await fetchSongMetadata(currentTrack.id, signal);
        if (fetched?.audioId) {
          source = mediaUrl(fetched.audioId);
          currentTrack = {
            ...currentTrack,
            ...toBaseTrack(fetched, currentTrack.coverUrl),
            url: source,
          };
          tracks.value = tracks.value.map((item) =>
            item.id === currentTrack.id ? currentTrack : item,
          );
        }
      }
      if (revision !== ownerRevision || signal?.aborted) {
        return;
      }
      const output = webAudio();
      webPlayback = undefined;
      output.pause();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrl = undefined;
      }
      if (!local && (app.offline || !source)) {
        replaceArtwork();
        output.removeAttribute("src");
        output.load();
        playbackError();
        return;
      }
      if (local instanceof Blob) {
        audioUrl = URL.createObjectURL(local);
      } else if (source && currentTrack.url !== source) {
        currentTrack = { ...currentTrack, url: source };
        tracks.value = tracks.value.map((item) =>
          item.id === currentTrack.id ? currentTrack : item,
        );
      }
      output.src = audioUrl ?? source;
      output.loop = mode.value === "single";
      output.volume = volume.value;
      output.currentTime = time;
      if (autoplay) {
        playWeb(output);
      }
      const hasCurrentArtwork =
        currentArtwork.value?.trackId === currentTrack.id &&
        currentArtwork.value.scope === scope &&
        currentArtwork.value.coverId === currentTrack.coverId;
      if (!hasCurrentArtwork) {
        let nextArtwork:
          | { trackId: string; scope: string; coverId: string; url: string }
          | undefined;
        if (scope && media && currentTrack.coverId) {
          let url = retainCoverObjectUrl(scope, currentTrack.coverId);
          if (!url) {
            const cover = await media.readOfflineMedia(scope, "cover", currentTrack.coverId);
            if (revision !== ownerRevision || signal?.aborted) {
              return;
            }
            if (cover instanceof Blob) {
              url = retainCoverObjectUrl(scope, currentTrack.coverId, cover);
            }
          }
          if (url) {
            nextArtwork = {
              trackId: currentTrack.id,
              scope,
              coverId: currentTrack.coverId,
              url,
            };
          }
        }
        replaceArtwork(nextArtwork);
        if (
          !nextArtwork &&
          currentTrack.coverId &&
          !isUsableCoverUrl(currentTrack.coverUrl) &&
          !app.offline
        ) {
          const coverId = currentTrack.coverId;
          const remoteCover = mediaUrl(coverId);
          if (remoteCover) {
            currentTrack = { ...currentTrack, coverUrl: remoteCover };
            tracks.value = tracks.value.map((item) =>
              item.id === currentTrack.id ? currentTrack : item,
            );
            if (scope && media) {
              void media.cacheOfflineMedia(
                scope,
                "cover",
                coverId,
                remoteCover,
                mediaWrites?.signal,
                apiOrigin(),
              );
            }
          }
        }
      }
      if ("mediaSession" in navigator) {
        const artwork =
          currentArtwork.value?.url ??
          (isUsableCoverUrl(currentTrack.coverUrl) ? currentTrack.coverUrl : null);
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist,
          album: currentTrack.album ?? "",
          artwork: artwork ? [{ src: artwork }] : [],
        });
      }
    }
  }

  function shuffleList(list: string[]) {
    const remaining = [...list];
    for (let index = remaining.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      const first = remaining[index];
      const second = remaining[swap];
      if (first && second) {
        [remaining[index], remaining[swap]] = [second, first];
      }
    }
    return remaining;
  }

  function arrange(list: string[], selected: string, playbackMode = mode.value) {
    if (playbackMode !== "shuffle") {
      return [...list];
    }
    return [selected, ...shuffleList(list.filter((track) => track !== selected))];
  }

  function canReuseQueue(selected: string, sourceKey?: string) {
    return Boolean(
      sourceKey &&
      sourceKey === queueSource.value &&
      ids.value.includes(selected) &&
      tracks.value.some((track) => track.id === selected),
    );
  }

  async function buildLocalTracks(
    list: string[],
    seedSongs: readonly Omit<Track, "url" | "coverUrl">[],
    signal?: AbortSignal,
  ) {
    const scope = session.offlineScope;
    const byId = new Map<string, Omit<Track, "url">>(tracks.value.map((track) => [track.id, track]));
    for (const song of seedSongs) {
      const previous = byId.get(song.id);
      byId.set(
        song.id,
        toBaseTrack(
          song,
          previous?.coverId === song.coverId && isUsableCoverUrl(previous.coverUrl)
            ? previous.coverUrl
            : null,
        ),
      );
    }
    const pending = pendingTrack.value;
    if (pending) {
      byId.set(pending.id, {
        ...pending,
        coverUrl: isUsableCoverUrl(pending.coverUrl) ? pending.coverUrl : null,
      });
    }
    let sources: Set<string> | Record<string, string> = native ? {} : new Set<string>();
    let cachedCovers: Record<string, Blob | string> = {};
    if (scope) {
      const [{ readOfflineSongs }, media] = await Promise.all([
        import("~/utils/offline-library"),
        import("~/utils/offline-media"),
      ]);
      const [offlineSongs, audioSources] = await Promise.all([
        readOfflineSongs(scope).catch(() => []),
        native ? media.readNativeAudioSources(scope) : media.readOfflineAudioIds(scope),
      ]);
      if (signal?.aborted) {
        return { resolved: [] as Track[], missing: [] as string[] };
      }
      sources = audioSources;
      for (const song of offlineSongs) {
        const existing = byId.get(song.id);
        byId.set(
          song.id,
          toBaseTrack(
            { ...song, audioId: existing?.audioId ?? song.audioId },
            existing?.coverId === song.coverId && isUsableCoverUrl(existing.coverUrl)
              ? existing.coverUrl
              : null,
          ),
        );
      }
      if (native) {
        const coverIds = [
          ...new Set(
            list.flatMap((trackId) => {
              const item = byId.get(trackId);
              return item?.coverId && !isNativeLocalUri(item.coverUrl ?? "") ? [item.coverId] : [];
            }),
          ),
        ];
        if (coverIds.length) {
          cachedCovers = await media.readOfflineCovers(scope, coverIds);
        }
      }
    }
    const resolved: Track[] = [];
    const missing: string[] = [];
    for (const trackId of list) {
      const item = byId.get(trackId);
      const localUrl =
        sources instanceof Set ? (sources.has(trackId) ? "" : undefined) : sources[trackId];
      if (!item) {
        missing.push(trackId);
        continue;
      }
      if (localUrl !== undefined) {
        const localCover = native && item.coverId ? cachedCovers[item.coverId] : undefined;
        const coverUrl =
          typeof localCover === "string"
            ? localCover
            : isUsableCoverUrl(item.coverUrl)
              ? item.coverUrl
              : resolveRemoteCoverUrl(item);
        resolved.push({ ...item, url: localUrl, coverUrl });
        continue;
      }
      if (app.offline) {
        continue;
      }
      const remoteUrl = resolveRemoteAudioUrl({ audioId: item.audioId, url: "" });
      if (!remoteUrl && !item.audioId) {
        missing.push(trackId);
        continue;
      }
      const localCover = native && item.coverId ? cachedCovers[item.coverId] : undefined;
      const coverUrl =
        typeof localCover === "string"
          ? localCover
          : isUsableCoverUrl(item.coverUrl)
            ? item.coverUrl
            : resolveRemoteCoverUrl(item);
      resolved.push({ ...item, url: remoteUrl, coverUrl });
    }
    return { resolved, missing };
  }

  function scheduleQueueSync(
    loadFullIds: (signal: AbortSignal) => Promise<string[]>,
    targetQueueKey: string | undefined,
    expectedOrderBase: string[],
  ) {
    if (app.offline) {
      return;
    }
    abortQueueSync();
    const controller = new AbortController();
    const { signal } = controller;
    const revision = ownerRevision;
    const userId = owner;
    queueSync = controller;
    void (async () => {
      try {
        const fullIds = await loadFullIds(signal);
        if (
          signal.aborted ||
          app.offline ||
          revision !== ownerRevision ||
          owner !== userId ||
          !fullIds.length
        ) {
          return;
        }
        const existingById = new Map(tracks.value.map((item) => [item.id, item]));
        const { resolved, missing } = await buildLocalTracks(fullIds, [], signal);
        if (signal.aborted || revision !== ownerRevision || owner !== userId) {
          return;
        }
        const mergedMap = new Map<string, Track>(resolved.map((item) => [item.id, item]));
        if (missing.length && !app.offline) {
          const fetched = await lookupSongs(missing, signal);
          if (signal.aborted || revision !== ownerRevision || owner !== userId) {
            return;
          }
          for (const song of fetched) {
            const url = song.audioId ? mediaUrl(song.audioId) : "";
            const coverUrl = song.coverId ? mediaUrl(song.coverId) || null : null;
            mergedMap.set(song.id, { ...toBaseTrack(song, coverUrl), url });
          }
        }
        await new Promise<void>((resolve) => {
          operations = operations
            .then(async () => {
              if (
                signal.aborted ||
                revision !== ownerRevision ||
                owner !== userId ||
                !id.value ||
                !expectedOrderBase.includes(id.value)
              ) {
                return;
              }
              const valid = fullIds.filter((trackId) => mergedMap.has(trackId));
              if (!valid.length || !valid.includes(id.value)) {
                return;
              }
              const nextTracks: Track[] = valid.map((trackId) => {
                const currentItem = existingById.get(trackId);
                const fresh = mergedMap.get(trackId)!;
                if (currentItem && isNativeLocalUri(currentItem.url)) {
                  return currentItem;
                }
                return fresh;
              });
              const currentOrderSet = new Set(order.value);
              const validSet = new Set(valid);
              const keptOrder = order.value.filter((trackId) => validSet.has(trackId));
              const appended = valid.filter((trackId) => !currentOrderSet.has(trackId));
              const nextAppended = mode.value === "shuffle" ? shuffleList(appended) : appended;
              const nextOrder = [...keptOrder, ...nextAppended];
              const byTrackId = new Map(nextTracks.map((item) => [item.id, item]));
              if (native && player && nativeQueueSynced) {
                const removed = order.value.filter((trackId) => !validSet.has(trackId));
                if (removed.length) {
                  await player.removeItems({
                    items: removed.map((trackId) => ({ id: trackId })),
                  });
                }
                if (nextAppended.length) {
                  const itemsToAdd = nextAppended.flatMap((trackId) => {
                    const item = byTrackId.get(trackId);
                    return item ? [nativeItem(item)] : [];
                  });
                  if (itemsToAdd.length) {
                    await player.addAllItems({ items: itemsToAdd });
                  }
                }
                await player.setRepeatMode({ mode: nativeRepeatMode(mode.value, nextOrder.length) });
              }
              tracks.value = nextTracks;
              ids.value = valid;
              order.value = nextOrder;
              if (targetQueueKey) {
                queueSource.value = targetQueueKey;
              }
            })
            .catch(() => undefined)
            .finally(resolve);
        });
      } catch {
        // Background queue completion must never interrupt already-playing cached tracks.
      } finally {
        if (queueSync === controller) {
          queueSync = undefined;
        }
      }
    })();
  }

  async function setQueue(
    list: string[],
    selected: string,
    autoplay: boolean,
    snapshot?: PlaybackSnapshot,
    signal?: AbortSignal,
    sourceKey: string | undefined = queueSource.value,
    seedSongs: readonly Omit<Track, "url" | "coverUrl">[] = [],
  ) {
    const userId = owner;
    const generation = ownerRevision;
    if (!userId || userId !== requestedOwner) {
      return;
    }
    const { resolved, missing } = await buildLocalTracks(list, seedSongs, signal);
    if (generation !== ownerRevision || signal?.aborted) {
      return;
    }
    const availableMap = new Map<string, Track>(resolved.map((track) => [track.id, track]));
    let backgroundMissing = missing;
    if (!app.offline && missing.includes(selected)) {
      try {
        const fetched = await lookupSongs([selected], signal);
        if (generation !== ownerRevision || signal?.aborted) {
          return;
        }
        for (const song of fetched) {
          const url = song.audioId ? mediaUrl(song.audioId) : "";
          const coverUrl = song.coverId ? mediaUrl(song.coverId) || null : null;
          availableMap.set(song.id, { ...toBaseTrack(song, coverUrl), url });
        }
        backgroundMissing = missing.filter((trackId) => trackId !== selected);
      } catch (cause) {
        if (!app.offline) {
          throw cause;
        }
      }
    }
    if (generation !== ownerRevision || signal?.aborted) {
      return;
    }
    const valid = list.filter((trackId) => availableMap.has(trackId));
    if (app.offline && autoplay && !availableMap.has(selected)) {
      playbackError();
      return;
    }
    if (!valid.length) {
      if (!app.offline && backgroundMissing.length) {
        const fetched = await lookupSongs(backgroundMissing, signal).catch(() => []);
        if (generation !== ownerRevision || signal?.aborted) {
          return;
        }
        for (const song of fetched) {
          const url = song.audioId ? mediaUrl(song.audioId) : "";
          const coverUrl = song.coverId ? mediaUrl(song.coverId) || null : null;
          availableMap.set(song.id, { ...toBaseTrack(song, coverUrl), url });
        }
        backgroundMissing = [];
      }
      const refetchedValid = list.filter((trackId) => availableMap.has(trackId));
      if (!refetchedValid.length) {
        if (!app.offline) {
          await clearQueue();
        } else {
          nativeQueueSynced = false;
          await player?.clearAllItems();
        }
        if (list.length) {
          error.value = "队列里没有可播放的歌曲。";
        }
        return;
      }
      valid.push(...refetchedValid);
    }
    const nextTracks = valid.map((trackId) => availableMap.get(trackId)!);
    tracks.value = nextTracks;
    ids.value = valid;
    queueSource.value = backgroundMissing.length ? "" : (sourceKey ?? "");
    mode.value = snapshot?.mode ?? mode.value;
    if (mode.value === "loop" && valid.length < 2) {
      mode.value = "sequential";
    }
    const next = availableMap.has(selected) ? selected : valid[0];
    if (!next) {
      return;
    }
    const previousOrder = snapshot?.order.filter((trackId) => availableMap.has(trackId));
    order.value = previousOrder?.length === valid.length ? previousOrder : arrange(valid, next);
    nativeQueueSynced = false;
    await load(
      next,
      next === selected ? (snapshot?.position ?? 0) : 0,
      autoplay,
      signal,
      true,
    );
    if (!app.offline && backgroundMissing.length && generation === ownerRevision && !signal?.aborted) {
      scheduleQueueSync(async () => list, sourceKey, valid);
    }
  }

  async function restore() {
    const raw = localStorage.getItem(storageKey(owner));
    if (!raw) {
      return;
    }
    let snapshot: PlaybackSnapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      !snapshot ||
      !Array.isArray(snapshot.ids) ||
      !Array.isArray(snapshot.order) ||
      !snapshot.ids.every((id) => typeof id === "string") ||
      !snapshot.order.every((id) => typeof id === "string") ||
      typeof snapshot.id !== "string" ||
      !Number.isFinite(snapshot.position) ||
      !Number.isFinite(snapshot.volume) ||
      !["loop", "single", "shuffle", "sequential"].includes(snapshot.mode) ||
      (snapshot.queueKey !== undefined && typeof snapshot.queueKey !== "string")
    ) {
      return;
    }
    volume.value = Math.max(0, Math.min(1, snapshot.volume));
    await setQueue(snapshot.ids, snapshot.id, false, snapshot, undefined, snapshot.queueKey);
  }

  async function toggle() {
    if (!current.value) {
      return;
    }
    if (player) {
      if (playing.value) {
        await player.pause();
      } else {
        await player.play();
      }
    } else if (audio) {
      if (audio.paused) {
        playWeb(audio);
      } else {
        audio.pause();
      }
    }
  }

  async function step(direction: number, ended = false) {
    if (player) {
      if (direction === 1) {
        await player.skipForward();
      } else {
        await player.skipBack();
      }
      return;
    }
    const scope = app.offline ? session.offlineScope : undefined;
    const available = scope
      ? await (await import("~/utils/offline-media")).readOfflineAudioIds(scope)
      : undefined;
    const index = order.value.indexOf(id.value) + direction;
    const following =
      direction === 1
        ? [
            ...order.value.slice(index),
            ...(mode.value === "loop" ? order.value.slice(0, index) : []),
          ]
        : order.value.slice(0, index + 1).reverse();
    const next = following.find((trackId) => !available || available.has(trackId));
    if (next) {
      await load(next, 0, true);
    } else if (ended && direction > 0) {
      audio?.pause();
      playing.value = false;
    }
  }

  async function seek(time: number) {
    if (!Number.isFinite(time) || time < 0) {
      return;
    }
    if (player) {
      nativeSeeking.value = true;
      try {
        await player.seekTo({ position: time });
        if (!nativeProgress || visibility.value !== "visible") {
          position.value = time;
        }
      } finally {
        nativeSeeking.value = false;
      }
      const revision = ownerRevision;
      const trackId = id.value;
      await readNativeProgress();
      if (
        revision === ownerRevision &&
        trackId === id.value &&
        sampledPosition.value !== undefined
      ) {
        position.value = sampledPosition.value;
      }
    } else if (audio) {
      audio.currentTime = time;
      position.value = audio.currentTime;
      sampledPosition.value = playing.value ? audio.currentTime : undefined;
    }
  }

  async function setVolume(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return;
    }
    volume.value = value;
    if (player) {
      await player.setPlaybackVolume({ volume: value });
    }
    if (audio) {
      audio.volume = value;
    }
  }

  async function setMode(value: PlaybackMode) {
    const nextMode = value === "loop" && ids.value.length < 2 ? "sequential" : value;
    if (nextMode === mode.value) {
      return;
    }
    if (!id.value) {
      mode.value = nextMode;
      return;
    }
    const nextOrder = arrange(ids.value, id.value, nextMode);
    if (player && nativeQueueSynced) {
      const nativeOrder = [...order.value];
      for (const [index, trackId] of nextOrder.entries()) {
        const from = nativeOrder.indexOf(trackId);
        if (from < 0 || from === index) {
          continue;
        }
        await player.moveItem({ from, to: index });
        nativeOrder.splice(from, 1);
        nativeOrder.splice(index, 0, trackId);
      }
      await player.setRepeatMode({ mode: nativeRepeatMode(nextMode, nextOrder.length) });
    }
    if (audio) {
      audio.loop = nextMode === "single";
    }
    mode.value = nextMode;
    order.value = nextOrder;
  }

  async function refresh() {
    abortQueueSync();
    if (!ids.value.length) {
      await restore();
      return;
    }
    await setQueue(ids.value, id.value, true, playbackSnapshot(), undefined, queueSource.value);
  }

  async function clearQueue() {
    abortQueueSync();
    webPlayback = undefined;
    nativeQueueSynced = false;
    resetQueue();
    if (owner) {
      localStorage.removeItem(storageKey(owner));
    }
    if (player) {
      await player.clearAllItems();
    }
    if (audio) {
      audio.loop = false;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    releaseObjectUrls();
  }

  function resetQueue() {
    tracks.value = [];
    ids.value = [];
    order.value = [];
    queueSource.value = "";
    id.value = "";
    position.value = 0;
    playing.value = false;
    loading.value = false;
  }

  async function remove(trackId: string) {
    if (!ids.value.includes(trackId)) {
      return;
    }
    abortQueueSync();
    const remaining = ids.value.filter((item) => item !== trackId);
    if (!remaining.length) {
      await clearQueue();
      return;
    }
    const selected = trackId === id.value;
    if (selected) {
      await player?.pause();
      audio?.pause();
    }
    await setQueue(
      remaining,
      selected ? (remaining[0] ?? "") : id.value,
      !selected && playing.value,
      {
        ids: remaining,
        order: order.value.filter((item) => item !== trackId),
        id: id.value,
        position: selected ? 0 : position.value,
        volume: volume.value,
        mode: mode.value,
        queueKey: queueSource.value,
      },
      undefined,
      queueSource.value,
    );
  }

  async function release() {
    const output = player;
    const statusListener = listener;
    listener = undefined;
    nativeProgress = undefined;
    player = undefined;
    nativeQueueSynced = false;
    nativeResumeAfterError = false;
    if (audio) {
      audio.ontimeupdate = audio.onplay = audio.onpause = audio.onended = audio.onerror = null;
      audio.onloadstart = audio.onwaiting = audio.oncanplay = audio.onplaying = null;
      audio.onemptied = audio.onabort = null;
      audio.loop = false;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    releaseObjectUrls();
    if (audio && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekto"] as const) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    }
    audio = undefined;
    await Promise.allSettled([statusListener?.remove()]);
    await Promise.allSettled([output?.release()]);
  }

  function setOwner(userId: string) {
    if (!import.meta.client || requestedOwner === userId) {
      return operations;
    }
    requestedOwner = userId;
    const generation = ++ownerRevision;
    selection?.abort();
    selection = undefined;
    abortQueueSync();
    pendingTrack.value = undefined;
    mediaWrites?.abort();
    mediaWrites = userId ? new AbortController() : undefined;
    webPlayback = undefined;
    audio?.pause();
    void player?.pause().catch(() => undefined);
    resetQueue();
    operations = operations.then(async () => {
      if (generation !== ownerRevision) {
        return;
      }
      await release();
      if (generation !== ownerRevision) {
        return;
      }
      owner = userId;
      mode.value = "sequential";
      volume.value = 1;
      error.value = "";
      if (userId) {
        try {
          await restore();
        } catch {
          if (generation === ownerRevision) {
            playbackError();
          }
        }
      }
    });
    return operations;
  }

  function run(action: () => Promise<void>, signal?: AbortSignal) {
    const userId = requestedOwner;
    const generation = ownerRevision;
    operations = operations.then(async () => {
      if (!userId || owner !== userId || generation !== ownerRevision || signal?.aborted) {
        return;
      }
      error.value = "";
      try {
        await action();
      } catch {
        if (generation === ownerRevision && !signal?.aborted) {
          playbackError();
        }
      }
    });
    return operations;
  }

  watch(
    () => app.offline,
    (offline) => {
      if (!offline || !id.value) {
        return;
      }
      abortQueueSync();
      if (native) {
        const snapshot = playbackSnapshot();
        snapshot.position = sampledPosition.value ?? snapshot.position;
        const autoplay = playing.value || nativeResumeAfterError;
        void run(async () => {
          if (!app.offline) {
            return;
          }
          const track = tracks.value.find((item) => item.id === snapshot.id);
          const cached = track && (await nativeCachedTrack(track));
          await setQueue(
            snapshot.ids,
            snapshot.id,
            Boolean(cached && autoplay),
            snapshot,
            undefined,
            "",
          );
          if (!cached) {
            playbackError();
          }
        });
      } else if (audio && !audioUrl) {
        const active = id.value;
        const time = position.value;
        const autoplay = playing.value;
        void run(() => load(active, time, autoplay));
      }
    },
  );

  if (native) {
    watch(
      () => session.mediaAuth,
      (auth) => {
        if (!auth || app.offline || !tracks.value.length) {
          return;
        }
        const revision = ownerRevision;
        operations = operations
          .then(async () => {
            if (revision !== ownerRevision || app.offline) {
              return;
            }
            const updated: Track[] = [];
            const replacements: Track[] = [];
            for (const track of tracks.value) {
              if (isNativeLocalUri(track.url)) {
                updated.push(track);
                continue;
              }
              const nextUrl = track.audioId ? mediaUrl(track.audioId) : track.url;
              const nextCover =
                track.coverId && !isNativeLocalUri(track.coverUrl ?? "")
                  ? mediaUrl(track.coverId) || track.coverUrl
                  : track.coverUrl;
              if (nextUrl !== track.url || nextCover !== track.coverUrl) {
                const next = { ...track, url: nextUrl, coverUrl: nextCover };
                updated.push(next);
                if (track.id !== id.value && nativeQueueSynced && player) {
                  replacements.push(next);
                }
              } else {
                updated.push(track);
              }
            }
            if (replacements.length && player && nativeQueueSynced) {
              for (const item of replacements) {
                if (revision !== ownerRevision) {
                  return;
                }
                await player.replaceItem({ id: item.id, item: nativeItem(item) });
              }
            }
            tracks.value = updated;
          })
          .catch(() => undefined);
      },
    );
  }

  async function play(
    track: Omit<Track, "url">,
    loadIds: (signal: AbortSignal) => Promise<string[]>,
    options?: PlayOptions,
  ) {
    if (!requestedOwner) {
      return;
    }
    selection?.abort();
    abortQueueSync();
    const controller = new AbortController();
    const { signal } = controller;
    selection = controller;
    const scope = session.offlineScope;
    let pendingCoverUrl = isUsableCoverUrl(track.coverUrl) ? track.coverUrl : null;
    if (track.coverUrl?.startsWith("blob:")) {
      const retained =
        !native && scope && track.coverId ? retainCoverObjectUrl(scope, track.coverId) : undefined;
      if (retained && scope && track.coverId) {
        replaceArtwork({ trackId: track.id, scope, coverId: track.coverId, url: retained });
      }
      pendingCoverUrl = null;
    }
    pendingTrack.value = { ...track, coverUrl: pendingCoverUrl };
    error.value = "";
    webPlayback = undefined;
    audio?.pause();
    let backgroundSync: (() => void) | undefined;
    try {
      await run(async () => {
        await player?.pause();
        if (signal.aborted) {
          return;
        }
        if (canReuseQueue(track.id, options?.queueKey)) {
          await load(track.id, 0, true, signal);
          return;
        }
        if (app.offline) {
          const list = await loadIds(signal);
          if (signal.aborted) {
            return;
          }
          await setQueue(list, track.id, true, undefined, signal, options?.queueKey);
          return;
        }
        const seedSongs = options?.seedSongs?.length ? options.seedSongs : [track];
        const seedIds = seedSongs.map((item) => item.id);
        if (!seedIds.includes(track.id)) {
          seedIds.unshift(track.id);
        }
        const needsFullQueue = Boolean(options?.needsFullQueue);
        await setQueue(
          seedIds,
          track.id,
          true,
          undefined,
          signal,
          needsFullQueue ? "" : options?.queueKey,
          seedSongs,
        );
        if (!signal.aborted && needsFullQueue && id.value === track.id) {
          const expectedBase = [...ids.value];
          backgroundSync = () => scheduleQueueSync(loadIds, options?.queueKey, expectedBase);
        }
      }, signal);
    } finally {
      if (selection === controller) {
        selection = undefined;
        pendingTrack.value = undefined;
        if (currentArtwork.value && currentArtwork.value.trackId !== id.value) {
          replaceArtwork();
        }
      }
    }
    backgroundSync?.();
  }

  return {
    tracks,
    ids,
    order,
    id,
    current,
    queue,
    position: computed(() => (pendingTrack.value ? 0 : (sampledPosition.value ?? position.value))),
    mode,
    volume,
    playing: computed(() => !pendingTrack.value && playing.value),
    loading: computed(() => Boolean(pendingTrack.value) || loading.value),
    error,
    setOwner,
    play,
    playQueuedTrack: (trackId: string) => run(() => load(trackId, 0, true)),
    toggle: () => run(toggle),
    step: (direction: number) => run(() => step(direction)),
    seek: (time: number) => run(() => seek(time)),
    setVolume: (value: number) => run(() => setVolume(value)),
    updateTrackMetadata(song: Song) {
      const apply = <T extends Omit<Track, "url">>(track: T): T =>
        track.id === song.id
          ? {
              ...track,
              title: song.title,
              artist: song.artist,
              album: song.album,
              year: song.year,
              lyrics: song.lyrics,
              audioId: song.audioId ?? track.audioId,
              coverId: song.coverId,
              coverUrl: track.coverId === song.coverId ? track.coverUrl : null,
            }
          : track;
      tracks.value = tracks.value.map(apply);
      if (pendingTrack.value?.id === song.id) {
        pendingTrack.value = apply(pendingTrack.value);
      }
      if (
        currentArtwork.value?.trackId === song.id &&
        currentArtwork.value.coverId !== song.coverId
      ) {
        replaceArtwork();
      }
    },
    setMode: (value: PlaybackMode) => run(() => setMode(value)),
    refresh: () => run(refresh),
    remove: (trackId: string) => run(() => remove(trackId)),
    invalidateQueue() {
      abortQueueSync();
      queueSource.value = "";
    },
  };
});
