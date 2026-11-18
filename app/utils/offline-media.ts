import { Capacitor, registerPlugin } from "@capacitor/core";
import { audioMaxBytes, coverMaxBytes } from "~~/shared/library-limits";
import type { NativeOfflineMediaPlugin } from "~/types/native-offline-media";
import { idbResult, offlineMaxAge, scopedKeys, withOfflineStore } from "./offline-library";

const quota = 256 * 1024 * 1024;
const rootName = "inyue-library-media";
const idPattern = /^[\da-f-]{36}$/;
const nativeMedia = registerPlugin<NativeOfflineMediaPlugin>("OfflineMedia");

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
  if (!navigator.storage?.getDirectory || !navigator.locks) return Promise.resolve(undefined);
  return navigator.locks.request(`${rootName}:${scope}`, callback);
}

export function removeMediaScope(scope: string) {
  if (Capacitor.isNativePlatform()) return nativeMedia.clean({ scope, removeScope: true });
  return locked(scope, async () => {
    await (await mediaRoot()).removeEntry(scope, { recursive: true });
  });
}

async function deleteMedia(scope: string, directory: FileSystemDirectoryHandle, name: string) {
  try {
    await directory.removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
  await withOfflineStore(scope, "readwrite", (store) => {
    store.delete(mediaKey(scope, name));
  });
}

export function removeOfflineAudio(scope: string, id: string) {
  if (Capacitor.isNativePlatform()) return nativeMedia.removeAudio({ scope, id });
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
    if (used <= limit && entry.accessedAt > oldest) break;
    await deleteMedia(scope, directory, entry.name);
    used -= entry.bytes;
  }
}

export function pruneOfflineMedia(scope: string) {
  if (Capacitor.isNativePlatform()) return nativeMedia.clean({ scope });
  return locked(scope, async () => {
    const entries = await mediaEntries(scope);
    if (!entries) return;
    const directory = await (await mediaRoot()).getDirectoryHandle(scope);
    await pruneMedia(scope, directory, entries);
    const known = new Set(entries.map(({ name }) => name));
    for await (const name of directory.keys()) {
      // A window can close between committing an OPFS file and indexing it.
      if (!known.has(name)) await directory.removeEntry(name);
    }
  });
}

async function readMedia(scope: string, directory: FileSystemDirectoryHandle, name: string) {
  const key = mediaKey(scope, name);
  const entry = await withOfflineStore(scope, "readonly", (store) =>
    idbResult<MediaEntry | undefined>(store.get(key)),
  );
  if (!entry || Date.now() - entry.accessedAt >= offlineMaxAge) return;
  const file = await (await directory.getFileHandle(name)).getFile();
  if (file.size !== entry.bytes) return;
  const accessible = await withOfflineStore(scope, "readwrite", async (store) => {
    const current = await idbResult<MediaEntry | undefined>(store.get(key));
    if (!current) return false;
    store.put({ ...current, accessedAt: Date.now() }, key);
    return true;
  });
  if (accessible) return file.slice(0, file.size, entry.type);
}

export function readOfflineMedia(scope: string, kind: Kind, id: string) {
  return (async () => {
    if (Capacitor.isNativePlatform()) {
      if (!await withOfflineStore(scope, "readonly", () => true)) return;
      const { uri } = await nativeMedia.read({ scope, kind, id });
      if (await withOfflineStore(scope, "readonly", () => true)) return uri;
      return;
    }
    const directory = await (await mediaRoot()).getDirectoryHandle(scope);
    return readMedia(scope, directory, `${kind}-${id}`);
  })().catch(() => undefined);
}

export async function readNativeAudioSources(scope: string) {
  try {
    if (await withOfflineStore(scope, "readonly", () => true)) {
      const { sources } = await nativeMedia.listAudio({ scope });
      if (await withOfflineStore(scope, "readonly", () => true)) return sources;
    }
  } catch {
    // The system may have reclaimed the app's media cache.
  }
  return {};
}

export async function readOfflineAudioIds(scope: string) {
  if (Capacitor.isNativePlatform()) return new Set(Object.keys(await readNativeAudioSources(scope)));
  try {
    const directory = await (await mediaRoot()).getDirectoryHandle(scope);
    const entries = await mediaEntries(scope);
    const oldest = Date.now() - offlineMaxAge;
    const ids = new Set<string>();
    for (const { name, accessedAt, bytes } of entries ?? []) {
      if (!name.startsWith("audio-") || accessedAt <= oldest) continue;
      const handle = await directory.getFileHandle(name).catch(() => undefined);
      const file = await handle?.getFile().catch(() => undefined);
      if (file?.size === bytes) ids.add(name.slice(6));
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
      if (source.origin !== origin || signal?.aborted ||
          !await withOfflineStore(scope, "readonly", () => true) || signal?.aborted) return;
      await nativeMedia.download({ scope, kind, id, origin, url });
    })().catch(() => undefined);
  }
  return locked(scope, async () => {
    if (signal?.aborted || !idPattern.test(id)) return;
    const source = new URL(url);
    if (source.origin !== location.origin || !/^\/api\/media\/[\da-f-]{36}$/.test(source.pathname))
      return;
    const entries = await mediaEntries(scope);
    if (!entries) return;
    const directory = await (await mediaRoot(true)).getDirectoryHandle(scope, { create: true });
    const name = `${kind}-${id}`;
    const existing = await readMedia(scope, directory, name).catch(() => undefined);
    if (existing) return;

    const maxBytes = kind === "audio" ? audioMaxBytes : coverMaxBytes;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(source, {
        cache: "no-store",
        credentials: "omit",
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
                if (bytes > maxBytes || (length && bytes > length))
                  throw new Error("Invalid media length");
                controller.enqueue(chunk);
              },
              flush() {
                if (!bytes || (length && bytes !== length)) throw new Error("Incomplete media");
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
        if (saved) return;
        await deleteMedia(scope, directory, name);
        return;
      } catch (error) {
        if (!response.body.locked) void response.body.cancel().catch(() => undefined);
        await deleteMedia(scope, directory, name).catch(() => undefined);
        if (
          !(error instanceof DOMException && error.name === "QuotaExceededError") ||
          signal?.aborted
        )
          return;
      }
    }
  }).catch(() => undefined);
}
