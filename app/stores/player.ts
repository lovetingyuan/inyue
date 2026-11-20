import { useSessionStore } from "~/stores/session";
import { useAppStore } from "~/stores/app";
import { useMusicApi } from "~/composables/useMusicApi";
import { computed, ref, shallowRef, watch } from "vue";
import type { PluginListenerHandle } from "@capacitor/core";
import type { PlaylistPlugin } from "@dwbn/capacitor-plugin-playlist";
import { useDocumentVisibility, useIntervalFn } from "@vueuse/core";
import { defineStore } from "pinia";
import type {
  MediaAuthorization,
  PlaybackMode,
  PlaybackSnapshot,
  SongDetails,
  Track,
} from "~~/shared/types/library";

export const usePlayerStore = defineStore("player", () => {
  const { apiOrigin, native, request } = useMusicApi();
  const app = useAppStore();
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
  const currentArtwork = shallowRef<{ trackId: string; url: string }>();
  const current = computed(() => {
    if (pendingTrack.value) {
      return pendingTrack.value;
    }
    const track = tracks.value.find((item) => item.id === id.value);
    const artwork = currentArtwork.value;
    return track && artwork?.trackId === track.id ? { ...track, coverUrl: artwork.url } : track;
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
  const nativeLoadTarget = ref("");
  const nativeSeeking = ref(false);
  let audio: HTMLAudioElement | undefined;
  let webPlayback: Promise<void> | undefined;
  let owner = "";
  let requestedOwner = "";
  let ownerRevision = 0;
  let operations = Promise.resolve();
  let authorization: AbortController | undefined;
  let selection: AbortController | undefined;
  let mediaWrites: AbortController | undefined;
  let audioUrl: string | undefined;
  let nativeResumeAfterError = false;
  const cachingTracks = new Set<string>();

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

  const { pause: stopProgressSampling, resume: startProgressSampling } = useIntervalFn(
    readNativeProgress,
    100,
    { immediate: false },
  );
  watch(
    [id, playing, pendingTrack, visibility, nativeLoadTarget, nativeSeeking],
    () => {
      nativeRead = undefined;
      sampledPosition.value = undefined;
      stopProgressSampling();
      if (readNativeProgress() && playing.value) {
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

  watch([ids, order, queueSource, id, position, mode, volume], () => {
    if (!import.meta.client || !owner || owner !== requestedOwner || !ids.value.length) {
      return;
    }
    try {
      localStorage.setItem(storageKey(owner), JSON.stringify(playbackSnapshot()));
    } catch {
      /* Storage may be unavailable. */
    }
  });

  function playbackError() {
    playing.value = false;
    loading.value = false;
    error.value = app.offline
      ? "这首歌曲尚未缓存，联网后可播放。"
      : "无法播放，请检查网络或登录状态，再刷新队列。";
  }

  function releaseObjectUrls() {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    if (currentArtwork.value) {
      URL.revokeObjectURL(currentArtwork.value.url);
    }
    audioUrl = undefined;
    currentArtwork.value = undefined;
  }

  function mediaUrlIsFresh(url: string) {
    try {
      const source = new URL(url);
      const expires = Number(source.searchParams.get("expires"));
      return (
        /^\/api\/media\/[\da-f-]{36}$/.test(source.pathname) &&
        Number.isFinite(expires) &&
        expires > Date.now() + 30_000
      );
    } catch {
      return false;
    }
  }

  async function cachePlayingTrack(track: Track) {
    const scope = useSessionStore().offlineScope;
    const signal = mediaWrites?.signal;
    if (
      !scope ||
      !signal ||
      app.offline ||
      audioUrl ||
      !track.url ||
      track.url.startsWith("file://")
    ) {
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
      const audio = cacheOfflineMedia(scope, "audio", track.id, track.url, signal, origin);
      if (!signal.aborted && !(await readOfflineSong(scope, track.id))) {
        const { _data } = await request<SongDetails>(`/api/songs/${track.id}`, { signal });
        if (_data && !signal.aborted) {
          await saveOfflineSongs(scope, [_data]);
        }
      }
      if (track.coverId && track.coverUrl) {
        void cacheOfflineMedia(scope, "cover", track.coverId, track.coverUrl, signal, origin);
      }
      await audio;
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
    const scope = useSessionStore().offlineScope;
    if (!scope) {
      return;
    }
    const { readOfflineMedia } = await import("~/utils/offline-media");
    const url = await readOfflineMedia(scope, "audio", track.id);
    if (typeof url !== "string") {
      return;
    }
    const cover = track.coverId ? await readOfflineMedia(scope, "cover", track.coverId) : undefined;
    return { ...track, url, coverUrl: typeof cover === "string" ? cover : track.coverUrl };
  }

  function promoteNativeCache(trackId: string) {
    const revision = ownerRevision;
    operations = operations
      .then(async () => {
        const output = player;
        if (!output || revision !== ownerRevision || trackId === id.value) {
          return;
        }
        const track = tracks.value.find((item) => item.id === trackId);
        if (!track || track.url.startsWith("file://")) {
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
        if (track?.url.startsWith("file://") && !app.offline) {
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
          if (track?.url.startsWith("file://")) {
            void nativeCachedTrack(track).catch(() => undefined);
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
        void run(() => step(1));
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

  async function load(selected: string, time: number, autoplay: boolean, signal?: AbortSignal) {
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
    if (native) {
      try {
        nativeResumeAfterError = false;
        const revision = ownerRevision;
        let source = await nativeCachedTrack(track);
        if (!source && !app.offline) {
          source = mediaUrlIsFresh(track.url) ? track : (await authorize([track.id]))[0];
        }
        if (revision !== ownerRevision || signal?.aborted || owner !== requestedOwner) {
          return;
        }
        if (!source) {
          playbackError();
          return;
        }
        const playable = source;
        if (playable !== track) {
          tracks.value = tracks.value.map((item) => (item.id === track.id ? playable : item));
        }
        await initializeNative();
        const output = player;
        if (owner !== requestedOwner || signal?.aborted || !output) {
          return;
        }
        await output.setLoop({ loop: mode.value === "loop" && order.value.length > 1 });
        await output.setPlaylistItems({
          items: queue.value.map(nativeItem),
          options: { startPaused: true, playFromId: selected },
        });
        await output.setPlaybackVolume({ volume: volume.value });
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
      const scope = useSessionStore().offlineScope;
      const media = scope ? await import("~/utils/offline-media") : undefined;
      const local = scope && (await media?.readOfflineMedia(scope, "audio", track.id));
      let source = local ? "" : track.url;
      if (!local && !app.offline && !mediaUrlIsFresh(source)) {
        const [remote] = await authorize([track.id]);
        source = remote?.url ?? "";
        if (remote) {
          tracks.value = tracks.value.map((item) => (item.id === track.id ? remote : item));
        }
      }
      if (revision !== ownerRevision || signal?.aborted) {
        return;
      }
      const output = webAudio();
      webPlayback = undefined;
      output.pause();
      releaseObjectUrls();
      if (!local && (app.offline || !source)) {
        output.removeAttribute("src");
        output.load();
        playbackError();
        return;
      }
      if (local instanceof Blob) {
        audioUrl = URL.createObjectURL(local);
      }
      output.src = audioUrl ?? source;
      output.volume = volume.value;
      output.currentTime = time;
      if (autoplay) {
        playWeb(output);
      }
      if (scope && media && track.coverId) {
        const cover = await media.readOfflineMedia(scope, "cover", track.coverId);
        if (revision !== ownerRevision || signal?.aborted) {
          return;
        }
        if (cover instanceof Blob) {
          currentArtwork.value = { trackId: track.id, url: URL.createObjectURL(cover) };
        }
      }
      if ("mediaSession" in navigator) {
        const artwork = currentArtwork.value?.url ?? track.coverUrl;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album ?? "",
          artwork: artwork ? [{ src: artwork }] : [],
        });
      }
    }
  }

  function arrange(list: string[], selected: string, playbackMode = mode.value) {
    if (playbackMode !== "shuffle") {
      return [...list];
    }
    const remaining = list.filter((track) => track !== selected);
    for (let index = remaining.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      const first = remaining[index];
      const second = remaining[swap];
      if (first && second) {
        [remaining[index], remaining[swap]] = [second, first];
      }
    }
    return [selected, ...remaining];
  }

  function canReuseQueue(selected: string, sourceKey?: string) {
    return Boolean(
      sourceKey &&
      sourceKey === queueSource.value &&
      ids.value.includes(selected) &&
      tracks.value.some((track) => track.id === selected),
    );
  }

  async function authorize(list: string[], controller = new AbortController()) {
    const { signal } = controller;
    authorization = controller;
    try {
      const authorized: Track[] = [];
      for (let index = 0; index < list.length; index += 80) {
        if (signal.aborted) {
          break;
        }
        const { _data } = await request<MediaAuthorization>("/api/media/authorize", {
          method: "POST",
          body: { songIds: list.slice(index, index + 80) },
          signal,
          timeout: 5000,
        });
        authorized.push(...(_data?.tracks ?? []));
      }
      return authorized;
    } finally {
      if (authorization === controller) {
        authorization = undefined;
      }
    }
  }

  async function setQueue(
    list: string[],
    selected: string,
    autoplay: boolean,
    snapshot?: PlaybackSnapshot,
    controller?: AbortController,
    sourceKey: string | undefined = queueSource.value,
  ) {
    const userId = owner;
    const generation = ownerRevision;
    if (!userId || userId !== requestedOwner) {
      return;
    }
    const scope = useSessionStore().offlineScope;
    const cached = new Map<string, Track>();
    if (scope) {
      const [{ readOfflineSongs }, media] = await Promise.all([
        import("~/utils/offline-library"),
        import("~/utils/offline-media"),
      ]);
      const [songs, sources] = await Promise.all([
        readOfflineSongs(scope).catch(() => []),
        native ? media.readNativeAudioSources(scope) : media.readOfflineAudioIds(scope),
      ]);
      const byId = new Map<string, Omit<Track, "url">>(
        tracks.value.map((track) => [track.id, track]),
      );
      for (const song of songs) {
        const previous = byId.get(song.id);
        byId.set(song.id, {
          ...song,
          coverUrl: previous?.coverId === song.coverId ? (previous.coverUrl ?? null) : null,
        });
      }
      const pending = pendingTrack.value;
      if (pending) {
        byId.set(pending.id, {
          ...pending,
          coverUrl: pending.coverUrl?.startsWith("blob:") ? null : pending.coverUrl,
        });
      }
      for (const trackId of list) {
        if (generation !== ownerRevision || controller?.signal.aborted) {
          return;
        }
        const url =
          sources instanceof Set ? (sources.has(trackId) ? "" : undefined) : sources[trackId];
        if (url === undefined) {
          continue;
        }
        let track = byId.get(trackId);
        if (!track && !app.offline && !controller?.signal.aborted) {
          const { _data } = await request<SongDetails>(`/api/songs/${trackId}`, {
            signal: controller?.signal,
          }).catch(() => ({ _data: undefined }));
          if (_data) {
            track = { ..._data, coverUrl: null };
          }
        }
        if (track) {
          cached.set(trackId, { ...track, url });
        }
      }
    }
    if (generation !== ownerRevision || controller?.signal.aborted) {
      return;
    }
    const missing = list.filter((trackId) => !cached.has(trackId));
    let remote: Track[] = [];
    if (!app.offline && missing.length) {
      try {
        remote = await authorize(missing, controller);
      } catch (error) {
        if (!app.offline) {
          throw error;
        }
      }
    }
    if (generation !== ownerRevision || controller?.signal.aborted) {
      return;
    }
    const authorized = [...cached.values(), ...remote];
    const available = new Set(authorized.map((track) => track.id));
    if (app.offline && autoplay && !available.has(selected)) {
      playbackError();
      return;
    }
    const valid = list.filter((track) => available.has(track));
    if (!valid.length) {
      if (!app.offline) {
        await clearQueue();
      } else {
        await player?.clearAllItems();
      }
      if (list.length) {
        error.value = "队列里没有可播放的歌曲。";
      }
      return;
    }
    tracks.value = authorized;
    ids.value = valid;
    queueSource.value = sourceKey ?? "";
    mode.value = snapshot?.mode ?? mode.value;
    if (mode.value === "loop" && valid.length < 2) {
      mode.value = "sequential";
    }
    const next = available.has(selected) ? selected : valid[0];
    if (!next) {
      return;
    }
    const previousOrder = snapshot?.order.filter((track) => available.has(track));
    order.value = previousOrder?.length === valid.length ? previousOrder : arrange(valid, next);
    await load(
      next,
      next === selected ? (snapshot?.position ?? 0) : 0,
      autoplay,
      controller?.signal,
    );
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
      !["loop", "shuffle", "sequential"].includes(snapshot.mode) ||
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

  async function step(direction: number) {
    if (player) {
      if (direction === 1) {
        await player.skipForward();
      } else {
        await player.skipBack();
      }
      return;
    }
    const scope = app.offline ? useSessionStore().offlineScope : undefined;
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
    } else if (direction > 0) {
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
    if (player) {
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
      await player.setLoop({ loop: nextMode === "loop" });
    }
    mode.value = nextMode;
    order.value = nextOrder;
  }

  async function refresh() {
    if (!ids.value.length) {
      await restore();
      return;
    }
    await setQueue(ids.value, id.value, true, playbackSnapshot(), undefined, queueSource.value);
  }

  async function clearQueue() {
    webPlayback = undefined;
    resetQueue();
    if (owner) {
      localStorage.removeItem(storageKey(owner));
    }
    if (player) {
      await player.clearAllItems();
    }
    if (audio) {
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
    const remaining = ids.value.filter((id) => id !== trackId);
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
        order: order.value.filter((id) => id !== trackId),
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
    nativeResumeAfterError = false;
    if (audio) {
      audio.ontimeupdate = audio.onplay = audio.onpause = audio.onended = audio.onerror = null;
      audio.onloadstart = audio.onwaiting = audio.oncanplay = audio.onplaying = null;
      audio.onemptied = audio.onabort = null;
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
    pendingTrack.value = undefined;
    authorization?.abort();
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
      if (native) {
        authorization?.abort();
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

  async function play(
    track: Omit<Track, "url">,
    loadIds: (signal: AbortSignal) => Promise<string[]>,
    options?: { queueKey?: string },
  ) {
    if (!requestedOwner) {
      return;
    }
    selection?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    selection = controller;
    pendingTrack.value = track;
    error.value = "";
    webPlayback = undefined;
    audio?.pause();
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
        const list = await loadIds(signal);
        if (signal.aborted) {
          return;
        }
        await setQueue(list, track.id, true, undefined, controller, options?.queueKey);
      }, signal);
    } finally {
      if (selection === controller) {
        selection = undefined;
        pendingTrack.value = undefined;
      }
    }
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
    updateTrackYear(trackId: string, year: number | null) {
      tracks.value = tracks.value.map((track) =>
        track.id === trackId ? { ...track, year } : track,
      );
    },
    setMode: (value: PlaybackMode) => run(() => setMode(value)),
    refresh: () => run(refresh),
    remove: (trackId: string) => run(() => remove(trackId)),
    invalidateQueue() {
      queueSource.value = "";
    },
  };
});
