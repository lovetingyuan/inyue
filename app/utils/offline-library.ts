import type { Playlist, Song, SongDetails, SongPage } from "~~/shared/types/library";
import { offlineSessionKey } from "~~/shared/offline-library";
import type { OfflineAccount, OfflineState } from "~/types/offline-library";

export const offlineMaxAge = 30 * 86_400_000;

const stateKey = "session";
const storeName = "library";
let database: Promise<IDBDatabase> | undefined;

export function idbResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
) {
  if (!database) {
    const request = indexedDB.open("inyue-offline", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    database = idbResult(request).catch((error: unknown) => {
      database = undefined;
      throw error;
    });
  }
  const db = await database;
  const tx = db.transaction(storeName, mode);
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const [value] = await Promise.all([work(tx.objectStore(storeName)), complete]);
  return value;
}

export function scopedKeys(prefix: string) {
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function getState(store: IDBObjectStore) {
  return idbResult<OfflineState | undefined>(store.get(stateKey));
}

export function readOfflineState() {
  return transaction("readonly", getState);
}

export async function changeOfflineAccount(expected: string | undefined, profile?: OfflineAccount) {
  const change = await transaction("readwrite", async (store) => {
    const current = await getState(store);
    if (current?.revision !== expected) return { state: current };
    const sameAccount =
      current?.profile && profile && current.profile.account.id === profile.account.id;
    if (!profile && !current?.profile) return { state: current };
    const state = { revision: sameAccount ? current.revision : crypto.randomUUID(), profile };
    store.put(state, stateKey);
    const removed = sameAccount ? undefined : current?.revision;
    if (removed) store.delete(scopedKeys(`${removed}/`));
    return { state, removed, switched: !sameAccount };
  });
  if (change.switched && change.state) {
    try {
      localStorage.setItem(offlineSessionKey, change.state.revision);
    } catch {
      // IndexedDB remains the source of truth if storage events are unavailable.
    }
  }
  if (change.removed) {
    const { removeMediaScope } = await import("./offline-media");
    void removeMediaScope(change.removed).catch(() => undefined);
  }
  return change.state;
}

export function withOfflineStore<T>(
  scope: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => T | Promise<T>,
) {
  return transaction(mode, async (store) => {
    const state = await getState(store);
    if (state?.revision !== scope || !state.profile || state.profile.expiresAt <= Date.now())
      return;
    return work(store);
  });
}

function songKey(scope: string, id: string) {
  return `${scope}/song/${id}`;
}

interface StoredSong {
  song: SongDetails;
  expires: number;
}

interface StoredPlaylists {
  items: Playlist[];
  expires: number;
}

export function saveOfflineSongs(scope: string, songs: SongDetails[]) {
  const expires = Date.now() + offlineMaxAge;
  return withOfflineStore(scope, "readwrite", (store) => {
    for (const song of songs) store.put({ song, expires }, songKey(scope, song.id));
  });
}

export function saveOfflinePlaylists(scope: string, items: Playlist[]) {
  return withOfflineStore(scope, "readwrite", (store) => {
    store.put({ items, expires: Date.now() + offlineMaxAge }, `${scope}/playlists`);
  });
}

export async function readOfflinePlaylists(scope: string) {
  const data = await withOfflineStore(scope, "readonly", (store) =>
    idbResult<StoredPlaylists | undefined>(store.get(`${scope}/playlists`)),
  );
  return data && data.expires > Date.now() ? data.items : [];
}

export async function readOfflineSong(scope: string, id: string) {
  const entry = await withOfflineStore(scope, "readonly", (store) =>
    idbResult<StoredSong | undefined>(store.get(songKey(scope, id))),
  );
  return entry && entry.expires > Date.now() ? entry.song : undefined;
}

export async function readOfflineSongs(
  scope: string,
  filters: { q?: string; playlist?: string } = {},
) {
  const entries = await withOfflineStore(scope, "readonly", (store) =>
    idbResult<StoredSong[]>(store.getAll(scopedKeys(songKey(scope, "")))),
  );
  const now = Date.now();
  const term = filters.q?.trim().slice(0, 250).toLowerCase();
  return (entries ?? [])
    .flatMap(({ song, expires }) => (expires > now ? [song] : []))
    .filter(
      ({ playlistIds, title, artist, album }) =>
        (!filters.playlist ||
          (filters.playlist === "default"
            ? !playlistIds.length
            : playlistIds.includes(filters.playlist))) &&
        (!term || [title, artist, album].some((value) => value?.toLowerCase().includes(term))),
    )
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

export async function readOfflineSongPage(
  scope: string,
  filters: { q: string; playlist: string },
  offset: number,
): Promise<SongPage> {
  const songs = await readOfflineSongs(scope, filters);
  return {
    items: songs.slice(offset, offset + 50),
    nextOffset: offset + 50 < songs.length ? offset + 50 : null,
    total: filters.q ? songs.length : undefined,
  };
}

export function removeOfflineSong(scope: string, id: string) {
  return withOfflineStore(scope, "readwrite", (store) => {
    store.delete(songKey(scope, id));
  });
}

export function updateOfflineSong(scope: string, song: Song) {
  return withOfflineStore(scope, "readwrite", async (store) => {
    const key = songKey(scope, song.id);
    const entry = await idbResult<StoredSong | undefined>(store.get(key));
    store.put(
      {
        song: { ...song, playlistIds: entry?.song.playlistIds ?? [] },
        expires: Date.now() + offlineMaxAge,
      },
      key,
    );
  });
}

export function updateOfflineMembership(
  scope: string,
  id: string,
  changes: { id: string; included: boolean }[],
) {
  return withOfflineStore(scope, "readwrite", async (store) => {
    const key = songKey(scope, id);
    const entry = await idbResult<StoredSong | undefined>(store.get(key));
    if (!entry) return;
    const ids = new Set(entry.song.playlistIds);
    for (const change of changes) {
      if (change.included) ids.add(change.id);
      else ids.delete(change.id);
    }
    entry.song.playlistIds = [...ids];
    store.put(entry, key);
  });
}

export function removeOfflinePlaylist(scope: string, id: string) {
  return withOfflineStore(scope, "readwrite", async (store) => {
    const key = `${scope}/playlists`;
    const [songs, playlists] = await Promise.all([
      idbResult<StoredSong[]>(store.getAll(scopedKeys(songKey(scope, "")))),
      idbResult<StoredPlaylists | undefined>(store.get(key)),
    ]);
    if (playlists)
      store.put({ ...playlists, items: playlists.items.filter((item) => item.id !== id) }, key);
    for (const entry of songs) {
      if (!entry.song.playlistIds.includes(id)) continue;
      entry.song.playlistIds = entry.song.playlistIds.filter((item) => item !== id);
      store.put(entry, songKey(scope, entry.song.id));
    }
  });
}

export function pruneOfflineMetadata(scope: string) {
  return withOfflineStore(scope, "readwrite", async (store) => {
    const [songs, playlists] = await Promise.all([
      idbResult<StoredSong[]>(store.getAll(scopedKeys(songKey(scope, "")))),
      idbResult<StoredPlaylists | undefined>(store.get(`${scope}/playlists`)),
    ]);
    const now = Date.now();
    for (const { song, expires } of songs)
      if (expires <= now) store.delete(songKey(scope, song.id));
    if (playlists && playlists.expires <= now) store.delete(`${scope}/playlists`);
  });
}
