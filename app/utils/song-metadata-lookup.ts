import {
  buildItunesSearchUrl,
  isAllowedCoverUrl,
  itunesSearchRegions,
  mergeSongMetadataCandidates,
  parseItunesSearchPayload,
} from "~~/shared/song-metadata";
import type {
  ItunesCountry,
  SongMetadataCandidate,
  SongMetadataSearchResult,
} from "~~/shared/types/song-metadata";

type DirectItunesRegionResult =
  | { ok: true; items: SongMetadataCandidate[] }
  | { ok: false; blocked: boolean };

async function fetchWithTimeout(
  url: URL,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      credentials: "omit",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function fetchItunesRegionDirect(
  query: string,
  country: ItunesCountry,
  signal: AbortSignal,
): Promise<DirectItunesRegionResult> {
  try {
    const response = await fetchWithTimeout(buildItunesSearchUrl(query, country), signal, 7000);
    if (!response.ok) {
      return { ok: false, blocked: response.status === 429 || response.status === 403 };
    }
    const data: unknown = await response.json();
    return { ok: true, items: parseItunesSearchPayload(data) };
  } catch (cause) {
    if (signal.aborted) {
      throw cause;
    }
    return { ok: false, blocked: false };
  }
}

export async function searchItunesMetadataDirect(
  query: string,
  signal: AbortSignal,
): Promise<SongMetadataSearchResult> {
  const [primaryCountry, secondaryCountry] = itunesSearchRegions(query);
  const primary = await fetchItunesRegionDirect(query, primaryCountry, signal);
  if (primary.ok) {
    const primaryMerged = mergeSongMetadataCandidates([primary.items]);
    if (primaryMerged.length >= 5) {
      return { items: primaryMerged };
    }
    const secondary = await fetchItunesRegionDirect(query, secondaryCountry, signal);
    return {
      items: mergeSongMetadataCandidates(
        secondary.ok ? [primary.items, secondary.items] : [primary.items],
      ),
    };
  }
  if (primary.blocked) {
    return { items: [], unavailable: true };
  }
  const secondary = await fetchItunesRegionDirect(query, secondaryCountry, signal);
  if (secondary.ok) {
    return { items: mergeSongMetadataCandidates([secondary.items]) };
  }
  return { items: [], unavailable: true };
}

export async function fetchCoverBlobDirect(
  coverUrl: string,
  signal: AbortSignal,
): Promise<Blob | null> {
  const target = isAllowedCoverUrl(coverUrl);
  if (!target) {
    return null;
  }
  try {
    const response = await fetchWithTimeout(target, signal, 8000);
    if (!response.ok) {
      return null;
    }
    return await response.blob();
  } catch (cause) {
    if (signal.aborted) {
      throw cause;
    }
    return null;
  }
}
