import { useInfiniteQuery, useQuery, useQueryState } from "@pinia/colada";
import type {
  MediaAuthorization,
  Playlist,
  Song,
  SongDetails,
  SongPage,
} from "~~/shared/types/library";
import { responseStatus } from "~/utils/library-error";
import { libraryKeys } from "~/utils/music-query-keys";

function connectionKey<T extends readonly unknown[]>(key: T, offline: boolean) {
  return offline ? ([...key, "offline"] as const) : key;
}

export function useLibraryQueries() {
  const session = useSessionStore();
  const library = useLibraryStore();
  const app = useAppStore();
  const { request } = useMusicApi();
  const enabled = () => Boolean(session.userId) && (!app.offline || !app.native);
  const songs = useInfiniteQuery<SongPage, Error, number>(() => {
    const filters = library.filters;
    const scope = session.offlineScope;
    const offline = app.offline;
    return {
      key: connectionKey([...libraryKeys.songs(session.userId), "pages", filters], offline),
      enabled: enabled(),
      // Retry the failed page request instead of refetching the loaded pages.
      retry: 0,
      initialPageParam: 0,
      query: async ({ pageParam, signal }) => {
        if (offline && scope) {
          const { readOfflineSongPage } = await import("~/utils/offline-library");
          return readOfflineSongPage(scope, filters, pageParam);
        }
        const { _data } = await request<SongPage>("/api/songs", {
          query: { ...filters, offset: pageParam },
          retry: 1,
          signal,
        });
        if (scope && _data && !signal.aborted) {
          const { saveOfflineSongs } = await import("~/utils/offline-library");
          await saveOfflineSongs(scope, _data.items).catch(() => undefined);
        }
        return _data ?? { items: [], nextOffset: null };
      },
      getNextPageParam: (page) => page.nextOffset,
    };
  });
  const playlists = useQuery(() => {
    const scope = session.offlineScope;
    const offline = app.offline;
    return {
      key: connectionKey(libraryKeys.playlists(session.userId), offline),
      enabled: enabled(),
      query: async ({ signal }) => {
        if (offline && scope) {
          const { readOfflinePlaylists } = await import("~/utils/offline-library");
          return readOfflinePlaylists(scope);
        }
        const { _data } = await request<Playlist[]>("/api/playlists", { signal });
        if (scope && _data && !signal.aborted) {
          const { saveOfflinePlaylists } = await import("~/utils/offline-library");
          await saveOfflinePlaylists(scope, _data).catch(() => undefined);
        }
        return _data ?? [];
      },
    };
  });
  useQuery(() => {
    const id = library.songId;
    const scope = session.offlineScope;
    const offline = app.offline;
    return {
      key: connectionKey(libraryKeys.song(session.userId, id ?? ""), offline),
      enabled: Boolean(id) && enabled(),
      query: async ({ signal }) => {
        if (!id) return;
        if (offline && scope) {
          const { readOfflineSong } = await import("~/utils/offline-library");
          const song = await readOfflineSong(scope, id);
          if (!song) throw new Error("歌曲详情尚未缓存。");
          return song;
        }
        try {
          const { _data } = await request<SongDetails>(`/api/songs/${id}`, { signal });
          if (scope && _data && !signal.aborted) {
            const { saveOfflineSongs } = await import("~/utils/offline-library");
            await saveOfflineSongs(scope, [_data]).catch(() => undefined);
          }
          return _data;
        } catch (cause) {
          if (scope && responseStatus(cause) === 404) {
            const { removeOfflineSong } = await import("~/utils/offline-library");
            await removeOfflineSong(scope, id).catch(() => undefined);
          }
          throw cause;
        }
      },
    };
  });
  const player = usePlayerStore();

  function play(song: Song, coverUrl: string | null) {
    const { filters } = library;
    const scope = session.offlineScope;
    const queueKey = JSON.stringify([
      "songs",
      app.offline ? "offline" : "online",
      filters.playlist,
      filters.q,
    ]);
    return player.play(
      { ...song, coverUrl },
      async (signal) => {
        if (app.offline && scope) {
          const { readOfflineSongs } = await import("~/utils/offline-library");
          return (await readOfflineSongs(scope, filters)).map(({ id }) => id);
        }
        const { _data } = await request<{ ids: string[] }>("/api/songs", {
          query: { ...filters, ids: true },
          retry: 1,
          signal,
        });
        return _data?.ids ?? [];
      },
      { queueKey },
    );
  }

  return { songs, playlists, play };
}

export function usePlaylistState() {
  const session = useSessionStore();
  const app = useAppStore();
  const { data } = useQueryState<Playlist[]>(() =>
    connectionKey(libraryKeys.playlists(session.userId), app.offline),
  );
  const playlists = computed(() => data.value ?? []);
  const covers = useCoverState(() =>
    playlists.value.flatMap(({ coverId }) => (coverId ? [coverId] : [])),
  );
  return { playlists, covers };
}

export function useSongDetailsState() {
  const session = useSessionStore();
  const app = useAppStore();
  const library = useLibraryStore();
  return useQueryState<SongDetails>(() =>
    connectionKey(libraryKeys.song(session.userId, library.songId ?? ""), app.offline),
  );
}

export function useOfflineAudio() {
  const app = useAppStore();
  const session = useSessionStore();
  return useQuery(() => {
    const scope = session.offlineScope;
    return {
      key: [...libraryKeys.user(session.userId), "offline-audio", scope ?? ""],
      enabled: app.offline && !!scope,
      staleTime: 0,
      query: async () =>
        scope
          ? (await import("~/utils/offline-media")).readOfflineAudioIds(scope)
          : new Set<string>(),
    };
  }).data;
}

function coverIds(ids: readonly string[]) {
  return [...new Set(ids)].sort();
}

function coverKey(userId: string, ids: string[]) {
  return [...libraryKeys.user(userId), "covers", ids] as const;
}

function useCoverUrls(data: Readonly<Ref<Record<string, Blob | string> | undefined>>) {
  const urls = shallowRef<Record<string, string>>({});
  watchEffect((cleanup) => {
    const local: string[] = [];
    urls.value = Object.fromEntries(
      Object.entries(data.value ?? {}).map(([id, cover]) => {
        if (typeof cover === "string") return [id, cover];
        const url = URL.createObjectURL(cover);
        local.push(url);
        return [id, url];
      }),
    );
    cleanup(() => local.forEach((url) => URL.revokeObjectURL(url)));
  });
  return urls;
}

function useCoverState(ids: () => readonly string[]) {
  const session = useSessionStore();
  const app = useAppStore();
  const { data } = useQueryState<Record<string, Blob | string>>(() =>
    connectionKey(coverKey(session.userId, coverIds(ids())), app.offline),
  );
  return useCoverUrls(data);
}

export function useCoverQuery(ids: () => readonly string[]) {
  const session = useSessionStore();
  const app = useAppStore();
  const { request } = useMusicApi();
  const query = useQuery(() => {
    const list = coverIds(ids());
    const scope = session.offlineScope;
    const offline = app.offline;
    return {
      key: connectionKey(coverKey(session.userId, list), offline),
      enabled: Boolean(session.userId && list.length) && (!offline || !app.native),
      retry: 0,
      staleTime: 60 * 60 * 1000,
      query: async ({ signal }) => {
        const covers: Record<string, Blob | string> = {};
        const media = scope ? await import("~/utils/offline-media") : undefined;
        const missing: string[] = [];
        for (const id of list) {
          signal.throwIfAborted();
          const cover = scope && (await media?.readOfflineMedia(scope, "cover", id));
          if (cover) covers[id] = cover;
          else missing.push(id);
        }
        if (offline) return covers;
        for (let index = 0; index < missing.length; index += 80) {
          const { _data } = await request<MediaAuthorization>("/api/media/authorize", {
            method: "POST",
            body: { coverIds: missing.slice(index, index + 80) },
            signal,
          });
          Object.assign(covers, _data?.covers);
          if (scope && media) {
            const addressed = Object.entries(_data?.covers ?? {});
            void (async () => {
              for (const [id, url] of addressed) {
                if (signal.aborted) break;
                await media.cacheOfflineMedia(scope, "cover", id, url, signal);
              }
            })();
          }
        }
        return covers;
      },
    };
  });
  return { ...query, urls: useCoverUrls(query.data) };
}
