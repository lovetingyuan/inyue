import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEventBus } from "@vueuse/core";
import { audioMaxBytes, coverMaxBytes } from "~~/shared/library-limits";
import type { NativeOfflineMediaPlugin } from "~/types/native-offline-media";
import {
  idbResult,
  offlineMaxAge,
  readOfflineOwner,
  scopedKeys,
  withOfflineStore,
} from "./offline-library";
import { offlineAudioChanged } from "./music-query-keys";

const quota = 256 * 1024 * 1024;
const rootName = "inyue-library-media";
const idPattern = /^[\da-f-]{36}$/;
const nativeMedia = registerPlugin<NativeOfflineMediaPlugin>("OfflineMedia");
const audioChanges = useEventBus<string>(offlineAudioChanged);

type Kind = "audio" | "cover";

interface MediaEntry {
  name: string;
  type: string;
  bytes: number;
  accessedAt: number;
}

function mediaKey(scope: string, name: string) {
  return `${scope}/media/${name}`;
}

function mediaEntries(scope: string) {
  return withOfflineStore(scope, "readonly", (store) =>
    idbResult<MediaEntry[]>(store.getAll(scopedKeys(mediaKey(scope, "")))),
  );
}

async function mediaRoot(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(rootName, { create });
}

function locked<T>(scope: string, callback: () => Promise<T>): Promise<T | undefined> {
  if (!navigator.storage?.getDirectory || !navigator.locks) {
    return Promise.resolve(undefined);
  }
  return navigator.locks.request(`${rootName}:${scope}`, callback);
}

export function removeMediaScope(scope: string) {
  if (Capacitor.isNativePlatform()) {
    return nativeMedia.clean({ legacyScope: scope, removeScope: true });
  }
  return locked(scope, async () => {
    await (await mediaRoot()).removeEntry(scope, { recursive: true });
  });
}

export function readNativeOfflineStorageInfo(owner: string, legacyScope?: string) {
  return nativeMedia.getStorageInfo({ owner, legacyScope });
}

export async function pickNativeOfflineDirectory(owner: string, legacyScope?: string) {
  const result = await nativeMedia.pickDirectory({ owner, legacyScope });
  if (!result.canceled && legacyScope) {
    audioChanges.emit(legacyScope);
  }
  return result;
}

export async function resetNativeOfflineDirectory(owner: string, legacyScope?: string) {
  const result = await nativeMedia.resetDirectory({ owner, legacyScope });
  if (legacyScope) {
    audioChanges.emit(legacyScope);
  }
  return result;
}

export async function clearNativeOfflineMedia(owner: string, legacyScope?: string) {
  await nativeMedia.clean({ owner, legacyScope, removeScope: true });
  if (legacyScope) {
    audioChanges.emit(legacyScope);
  }
}

export async function exportNativeAudio(options: {
  scope?: string;
  id: string;
  fileName: string;
  url?: string;
  origin?: string;
}) {
  const owner = options.scope ? await readOfflineOwner(options.scope) : undefined;
  return nativeMedia.exportAudio({
    owner,
    legacyScope: options.scope,
    id: options.id,
    fileName: options.fileName,
    url: options.url,
    origin: options.origin,
  });
}

export async function prepareNativeShareAudio(options: {
  scope?: string;
  id: string;
  fileName: string;
  url?: string;
  origin?: string;
}) {
  const owner = options.scope ? await readOfflineOwner(options.scope) : undefined;
  return nativeMedia.prepareShareAudio({
    owner,
    legacyScope: options.scope,
    id: options.id,
    fileName: options.fileName,
    url: options.url,
    origin: options.origin,
  });
}

export function openNativeDownloads() {
  return nativeMedia.openDownloads();
}

async function deleteMedia(scope: string, directory: FileSystemDirectoryHandle, name: string) {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) {
      throw error;
    }
  }
  await withOfflineStore(scope, "readwrite", (store) => {
    store.delete(mediaKey(scope, name));
  });
  if (name.startsWith("audio-")) {
    audioChanges.emit(scope);
  }
}

export function removeOfflineAudio(scope: string, id: string) {
  if (Capacitor.isNativePlatform()) {
    return (async () => {
      const owner = await readOfflineOwner(scope);
      if (!owner) {
        return;
      }
      await nativeMedia.removeAudio({ owner, legacyScope: scope, id });
    })().finally(() => audioChanges.emit(scope));
  }
  return locked(scope, async () => {
    const directory = await (await mediaRoot()).getDirectoryHandle(scope);
    await deleteMedia(scope, directory, `audio-${id}`);
  });
}

async function pruneMedia(
  scope: string,
  directory: FileSystemDirectoryHandle,
  entries: MediaEntry[],
  incoming = 0,
  extraRoom = 0,
) {
  let used = entries.reduce((sum, { bytes }) => sum + bytes, 0);
  const estimate: StorageEstimate = incoming
    ? await navigator.storage.estimate().catch(() => ({}))
    : {};
  const { quota: browserQuota = Infinity, usage = 0 } = estimate;
  const reclaim = Math.max(0, incoming - (browserQuota - usage), extraRoom);
  const limit = Math.min(quota - incoming, used - reclaim);
  const oldest = Date.now() - offlineMaxAge;
  for (const entry of entries.sort((a, b) => a.accessedAt - b.accessedAt)) {
    if (used <= limit && entry.accessedAt > oldest) {
      break;
    }
    await deleteMedia(scope, directory, entry.name);
    used -= entry.bytes;
  }
}

export function pruneOfflineMedia(scope: string) {
  if (Capacitor.isNativePlatform()) {
    return (async () => {
      const owner = await readOfflineOwner(scope);
      if (!owner) {
        return;
      }
      await nativeMedia.clean({ owner, legacyScope: scope });
    })().finally(() => audioChanges.emit(scope));
  }
  return locked(scope, async () => {
    const entries = await mediaEntries(scope);
    if (!entries) {
      return;
    }
    const directory = await (await mediaRoot()).getDirectoryHandle(scope);
    await pruneMedia(scope, directory, entries);
    const known = new Set(entries.map(({ name }) => name));
    for await (const name of directory.keys()) {
      // A window can close between committing an OPFS file and indexing it.
      if (!known.has(name)) {
        await directory.removeEntry(name);
      }
    }
  });
}

async function readMedia(scope: string, directory: FileSystemDirectoryHandle, name: string) {
  const key = mediaKey(scope, name);
  const entry = await withOfflineStore(scope, "readonly", (store) =>
    idbResult<MediaEntry | undefined>(store.get(key)),
  );
  if (!entry || Date.now() - entry.accessedAt >= offlineMaxAge) {
    return;
  }
  const file = await (await directory.getFileHandle(name)).getFile();
  if (file.size !== entry.bytes) {
    return;
  }
  const accessible = await withOfflineStore(scope, "readwrite", async (store) => {
    const current = await idbResult<MediaEntry | undefined>(store.get(key));
    if (!current) {
      return false;
    }
    store.put({ ...current, accessedAt: Date.now() }, key);
    return true;
  });
  if (accessible) {
    return file.slice(0, file.size, entry.type);
  }
}

export function readOfflineMedia(scope: string, kind: Kind, id: string) {
  return (async () => {
    if (Capacitor.isNativePlatform()) {
      const owner = await readOfflineOwner(scope);
      if (!owner) {
        return;
      }
      const { uri } = await nativeMedia.read({ owner, legacyScope: scope, kind, id });
      if ((await readOfflineOwner(scope)) === owner) {
        return uri;
      }
      return;
    }
    const directory = await (await mediaRoot()).getDirectoryHandle(scope);
    return readMedia(scope, directory, `${kind}-${id}`);
  })().catch(() => undefined);
}

export async function readOfflineCovers(
  scope: string,
  ids: readonly string[],
): Promise<Record<string, Blob | string>> {
  if (!ids.length) {
    return {};
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const owner = await readOfflineOwner(scope);
      if (!owner) {
        return {};
      }
      const { uris } = await nativeMedia.readMany({
        owner,
        legacyScope: scope,
        kind: "cover",
        ids: [...ids],
      });
      if ((await readOfflineOwner(scope)) !== owner) {
        return {};
      }
      return uris;
    } catch {
      return {};
    }
  }
  try {
    const [directory, entries] = await Promise.all([
      (await mediaRoot()).getDirectoryHandle(scope),
      withOfflineStore(scope, "readonly", (store) =>
        Promise.all(
          ids.map(async (id) => {
            const entry = await idbResult<MediaEntry | undefined>(
              store.get(mediaKey(scope, `cover-${id}`)),
            );
            return [id, entry] as const;
          }),
        ),
      ),
    ]);
    if (!entries) {
      return {};
    }
    const now = Date.now();
    const candidates = entries.filter((pair): pair is readonly [string, MediaEntry] =>
      Boolean(pair[1] && now - pair[1].accessedAt < offlineMaxAge),
    );
    if (!candidates.length) {
      return {};
    }
    const files = await Promise.all(
      candidates.map(async ([id, entry]) => {
        const handle = await directory.getFileHandle(entry.name).catch(() => undefined);
        const file = await handle?.getFile().catch(() => undefined);
        if (!file || file.size !== entry.bytes) {
          return;
        }
        return { id, entry, blob: file.slice(0, file.size, entry.type) };
      }),
    );
    const loaded = files.filter((item) => item !== undefined);
    if (!loaded.length) {
      return {};
    }
    const accessible = await withOfflineStore(scope, "readwrite", async (store) => {
      const touchedAt = Date.now();
      const validIds = new Set<string>();
      await Promise.all(
        loaded.map(async ({ id, entry }) => {
          const key = mediaKey(scope, entry.name);
          const current = await idbResult<MediaEntry | undefined>(store.get(key));
          if (!current) {
            return;
          }
          store.put({ ...current, accessedAt: touchedAt }, key);
          validIds.add(id);
        }),
      );
      return validIds;
    });
    if (!accessible) {
      return {};
    }
    const covers: Record<string, Blob> = {};
    for (const { id, blob } of loaded) {
      if (accessible.has(id)) {
        covers[id] = blob;
      }
    }
    return covers;
  } catch {
    return {};
  }
}

export async function readNativeAudioSources(scope: string) {
  try {
    const owner = await readOfflineOwner(scope);
    if (owner) {
      const { sources } = await nativeMedia.listAudio({ owner, legacyScope: scope });
      if ((await readOfflineOwner(scope)) === owner) {
        return sources;
      }
    }
  } catch {
    // The system may have reclaimed the app's media cache.
  }
  return {};
}

export async function readOfflineAudioIds(scope: string) {
  if (Capacitor.isNativePlatform()) {
    return new Set(Object.keys(await readNativeAudioSources(scope)));
  }
  try {
    const [directory, entries] = await Promise.all([
      (await mediaRoot()).getDirectoryHandle(scope),
      mediaEntries(scope),
    ]);
    const oldest = Date.now() - offlineMaxAge;
    const candidates = (entries ?? []).filter(
      ({ name, accessedAt }) => name.startsWith("audio-") && accessedAt > oldest,
    );
    const verified = await Promise.all(
      candidates.map(async ({ name, bytes }) => {
        const handle = await directory.getFileHandle(name).catch(() => undefined);
        const file = await handle?.getFile().catch(() => undefined);
        return file?.size === bytes ? name.slice(6) : undefined;
      }),
    );
    const ids = new Set<string>();
    for (const id of verified) {
      if (id) {
        ids.add(id);
      }
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}

export function cacheOfflineMedia(
  scope: string,
  kind: Kind,
  id: string,
  url: string,
  signal?: AbortSignal,
  apiOrigin = "",
) {
  if (Capacitor.isNativePlatform()) {
    return (async () => {
      const origin = apiOrigin || location.origin;
      const source = new URL(url);
      if (source.origin !== origin || signal?.aborted) {
        return;
      }
      const owner = await readOfflineOwner(scope);
      if (!owner || signal?.aborted) {
        return;
      }
      await nativeMedia
        .download({ owner, legacyScope: scope, kind, id, origin, url })
        .finally(() => audioChanges.emit(scope));
    })().catch(() => undefined);
  }
  return locked(scope, async () => {
    if (signal?.aborted || !idPattern.test(id)) {
      return;
    }
    const source = new URL(url);
    if (
      source.origin !== location.origin ||
      !/^\/api\/media\/[\da-f-]{36}$/.test(source.pathname)
    ) {
      return;
    }
    const entries = await mediaEntries(scope);
    if (!entries) {
      return;
    }
    const directory = await (await mediaRoot(true)).getDirectoryHandle(scope, { create: true });
    const name = `${kind}-${id}`;
    const existing = await readMedia(scope, directory, name).catch(() => undefined);
    if (existing) {
      return;
    }

    const maxBytes = kind === "audio" ? audioMaxBytes : coverMaxBytes;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(source, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal,
      });
      const type = response.headers.get("content-type") ?? "";
      const length = Number(response.headers.get("content-length"));
      if (
        !response.body ||
        response.status !== 200 ||
        response.headers.has("content-range") ||
        !type.startsWith(kind === "audio" ? "audio/" : "image/") ||
        length > maxBytes
      ) {
        void response.body?.cancel().catch(() => undefined);
        return;
      }
      const budget = length || maxBytes;
      try {
        const indexed = attempt ? await mediaEntries(scope) : entries;
        if (!indexed) {
          void response.body.cancel().catch(() => undefined);
          return;
        }
        await pruneMedia(scope, directory, indexed, budget, attempt ? budget : 0);
        const handle = await directory.getFileHandle(name, { create: true });
        const writer = await handle.createWritable();
        let bytes = 0;
        await response.body
          .pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                bytes += chunk.byteLength;
                if (bytes > maxBytes || (length && bytes > length)) {
                  throw new Error("Invalid media length");
                }
                controller.enqueue(chunk);
              },
              flush() {
                if (!bytes || (length && bytes !== length)) {
                  throw new Error("Incomplete media");
                }
              },
            }),
          )
          .pipeTo(writer, { signal });
        const saved =
          !signal?.aborted &&
          (await withOfflineStore(scope, "readwrite", (store) => {
            const entry: MediaEntry = { name, type, bytes, accessedAt: Date.now() };
            store.put(entry, mediaKey(scope, name));
            return true;
          }));
        if (saved) {
          if (kind === "audio") {
            audioChanges.emit(scope);
          }
          return;
        }
        await deleteMedia(scope, directory, name);
        return;
      } catch (error) {
        if (!response.body.locked) {
          void response.body.cancel().catch(() => undefined);
        }
        await deleteMedia(scope, directory, name).catch(() => undefined);
        if (
          !(error instanceof DOMException && error.name === "QuotaExceededError") ||
          signal?.aborted
        ) {
          return;
        }
      }
    }
  }).catch(() => undefined);
}
