import type { ItunesCountry, SongMetadataCandidate } from "~~/shared/types/song-metadata";

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const allowedMzstaticHostPattern = /^[a-z0-9-]+\.mzstatic\.com$/i;
const allowedDzcdnHostPattern = /^[a-z0-9-]+\.dzcdn\.net$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

export function parseYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = /^([1-9]\d{3})/.exec(value.trim());
  return match?.[1] ? Number(match[1]) : null;
}

export function normalizeMetadataKey(value: string) {
  return value.toLowerCase().replace(/[\s\-_()[\]（）【】·.,!?，。！？'"’“”]+/g, "");
}

export function hasCjkText(value: string) {
  return cjkPattern.test(value);
}

export function itunesSearchRegions(query: string): readonly [ItunesCountry, ItunesCountry] {
  return hasCjkText(query) ? ["hk", "us"] : ["us", "hk"];
}

export function isAllowedCoverUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return null;
    }
    if (allowedMzstaticHostPattern.test(parsed.hostname) && parsed.pathname.startsWith("/image/")) {
      return parsed;
    }
    if (
      allowedDzcdnHostPattern.test(parsed.hostname) &&
      parsed.pathname.startsWith("/images/cover/")
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function toHighResItunesCoverUrl(artworkUrl: string | null): string | null {
  if (!artworkUrl) {
    return null;
  }
  const upgraded = artworkUrl.replace(/\/\d+x\d+bb\.(?:jpg|jpeg|png|webp)$/i, "/600x600bb.jpg");
  return isAllowedCoverUrl(upgraded)?.href ?? null;
}

export function buildItunesSearchUrl(query: string, country: ItunesCountry): URL {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "8");
  url.searchParams.set("country", country);
  url.searchParams.set("lang", "zh_cn");
  return url;
}

export function parseItunesSearchPayload(data: unknown): SongMetadataCandidate[] {
  if (!isRecord(data) || !Array.isArray(data.results)) {
    return [];
  }

  const items: SongMetadataCandidate[] = [];
  for (const entry of data.results) {
    if (!isRecord(entry)) {
      continue;
    }
    const title = cleanText(entry.trackName, 250);
    const artist = cleanText(entry.artistName, 250);
    if (!title || !artist) {
      continue;
    }
    const id =
      typeof entry.trackId === "number" && Number.isFinite(entry.trackId)
        ? `itunes:${entry.trackId}`
        : `itunes:${title}:${artist}`;
    const rawArtwork = cleanText(entry.artworkUrl100, 1000);
    const artworkUrl = rawArtwork ? (isAllowedCoverUrl(rawArtwork)?.href ?? null) : null;
    const durationMs =
      typeof entry.trackTimeMillis === "number" &&
      Number.isFinite(entry.trackTimeMillis) &&
      entry.trackTimeMillis > 0
        ? entry.trackTimeMillis
        : null;
    items.push({
      id,
      title,
      artist,
      album: cleanText(entry.collectionName, 250),
      year: parseYear(entry.releaseDate),
      duration: durationMs ? Math.round(durationMs / 1000) : null,
      artworkUrl,
      coverUrl: toHighResItunesCoverUrl(artworkUrl),
    });
  }
  return items;
}

export function mergeSongMetadataCandidates(
  lists: readonly (readonly SongMetadataCandidate[])[],
  limit = 10,
): SongMetadataCandidate[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const merged: SongMetadataCandidate[] = [];
  for (const list of lists) {
    for (const candidate of list) {
      const signature = `${normalizeMetadataKey(candidate.title)}|${normalizeMetadataKey(candidate.artist)}|${normalizeMetadataKey(candidate.album ?? "")}`;
      if (seenIds.has(candidate.id) || seenKeys.has(signature)) {
        continue;
      }
      seenIds.add(candidate.id);
      seenKeys.add(signature);
      merged.push(candidate);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }
  return merged;
}
