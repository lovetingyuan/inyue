import { lyricsMaxBytes } from "~~/shared/library-limits";
import { parseLrc } from "~~/shared/lrc";
import {
  buildItunesSearchUrl,
  cleanText,
  hasCjkText,
  isAllowedCoverUrl,
  isRecord,
  itunesSearchRegions,
  mergeSongMetadataCandidates,
  normalizeMetadataKey,
  parseItunesSearchPayload,
} from "~~/shared/song-metadata";
import type {
  ItunesCountry,
  SongMetadataCandidate,
  SongMetadataEnrichRequest,
  SongMetadataEnrichResult,
  SongMetadataSearchResult,
} from "~~/shared/types/song-metadata";

const userAgent = "inYue/1.0 (https://inyue.tingyuan.nz)";
const encoder = new TextEncoder();

interface DeepSeekConfig {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
}

type ItunesRegionFetchResult =
  | { ok: true; items: SongMetadataCandidate[] }
  | { ok: false; blocked: boolean };

function cleanMultilineText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

async function fetchItunesRegion(
  query: string,
  country: ItunesCountry,
): Promise<ItunesRegionFetchResult> {
  try {
    const response = await fetch(buildItunesSearchUrl(query, country), {
      headers: { accept: "application/json", "user-agent": userAgent },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { ok: false, blocked: response.status === 429 || response.status === 403 };
    }
    const data: unknown = await response.json();
    return { ok: true, items: parseItunesSearchPayload(data) };
  } catch {
    return { ok: false, blocked: false };
  }
}

async function fetchDeezerSearch(query: string): Promise<SongMetadataCandidate[]> {
  const url = new URL("https://api.deezer.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");

  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Deezer status ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.error || !Array.isArray(payload.data)) {
    throw new Error("Deezer invalid response");
  }

  const items: SongMetadataCandidate[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry)) {
      continue;
    }
    const title = cleanText(entry.title, 250);
    const artist = isRecord(entry.artist) ? cleanText(entry.artist.name, 250) : null;
    if (!title || !artist) {
      continue;
    }
    const albumRecord = isRecord(entry.album) ? entry.album : null;
    const rawThumb =
      cleanText(albumRecord?.cover_medium, 1000) ?? cleanText(albumRecord?.cover_small, 1000);
    const rawCover =
      cleanText(albumRecord?.cover_big, 1000) ?? cleanText(albumRecord?.cover_xl, 1000) ?? rawThumb;
    const artworkUrl = rawThumb ? (isAllowedCoverUrl(rawThumb)?.href ?? null) : null;
    const coverUrl = rawCover ? (isAllowedCoverUrl(rawCover)?.href ?? artworkUrl) : artworkUrl;
    const duration =
      typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration > 0
        ? Math.round(entry.duration)
        : null;
    const id =
      typeof entry.id === "number" && Number.isFinite(entry.id)
        ? `deezer:${entry.id}`
        : `deezer:${title}:${artist}`;

    items.push({
      id,
      title,
      artist,
      album: cleanText(albumRecord?.title, 250),
      year: null,
      duration,
      artworkUrl,
      coverUrl,
    });
  }
  return items;
}

async function fetchLrclibSearchCandidates(query: string): Promise<SongMetadataCandidate[]> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`LRCLIB status ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    return [];
  }

  const syncedItems: SongMetadataCandidate[] = [];
  const otherItems: SongMetadataCandidate[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) {
      continue;
    }
    const title = cleanText(entry.trackName, 250);
    const artist = cleanText(entry.artistName, 250);
    if (!title || !artist) {
      continue;
    }
    const duration =
      typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration > 0
        ? Math.round(entry.duration)
        : null;
    const id =
      typeof entry.id === "number" && Number.isFinite(entry.id)
        ? `lrclib:${entry.id}`
        : `lrclib:${title}:${artist}`;
    const candidate: SongMetadataCandidate = {
      id,
      title,
      artist,
      album: cleanText(entry.albumName, 250),
      year: null,
      duration,
      artworkUrl: null,
      coverUrl: null,
    };
    if (typeof entry.syncedLyrics === "string" && entry.syncedLyrics.trim()) {
      syncedItems.push(candidate);
    } else {
      otherItems.push(candidate);
    }
  }
  return [...syncedItems, ...otherItems].slice(0, 12);
}

export async function searchSongMetadata(query: string): Promise<SongMetadataSearchResult> {
  const [primaryCountry, secondaryCountry] = itunesSearchRegions(query);
  let anySourceSucceeded = false;

  const primary = await fetchItunesRegion(query, primaryCountry);
  if (primary.ok) {
    anySourceSucceeded = true;
    const primaryMerged = mergeSongMetadataCandidates([primary.items]);
    if (primaryMerged.length >= 5) {
      return { items: primaryMerged };
    }
    const secondary = await fetchItunesRegion(query, secondaryCountry);
    const merged = mergeSongMetadataCandidates(
      secondary.ok ? [primary.items, secondary.items] : [primary.items],
    );
    if (merged.length) {
      return { items: merged };
    }
  } else if (!primary.blocked) {
    const secondary = await fetchItunesRegion(query, secondaryCountry);
    if (secondary.ok) {
      anySourceSucceeded = true;
      const merged = mergeSongMetadataCandidates([secondary.items]);
      if (merged.length) {
        return { items: merged };
      }
    }
  }

  const fallbackSources = hasCjkText(query)
    ? [fetchLrclibSearchCandidates(query), fetchDeezerSearch(query)]
    : [fetchDeezerSearch(query), fetchLrclibSearchCandidates(query)];
  const settled = await Promise.allSettled(fallbackSources);
  const fulfilled = settled.filter(
    (item): item is PromiseFulfilledResult<SongMetadataCandidate[]> => item.status === "fulfilled",
  );
  if (fulfilled.length) {
    anySourceSucceeded = true;
  }
  if (!anySourceSucceeded) {
    return { items: [], unavailable: true };
  }
  return {
    items: mergeSongMetadataCandidates(fulfilled.map((item) => item.value)),
  };
}

function validSyncedLyrics(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text || encoder.encode(text).byteLength > lyricsMaxBytes) {
    return null;
  }
  return parseLrc(text).length ? text : null;
}

function scoreLrcEntry(
  entry: Record<string, unknown>,
  targetTitle: string,
  targetArtist: string,
  targetDuration: number | null,
) {
  let score = 0;
  const title = typeof entry.trackName === "string" ? normalizeMetadataKey(entry.trackName) : "";
  const artist = typeof entry.artistName === "string" ? normalizeMetadataKey(entry.artistName) : "";
  if (title && title === targetTitle) {
    score += 4;
  } else if (title && (title.includes(targetTitle) || targetTitle.includes(title))) {
    score += 2;
  }
  if (artist && artist === targetArtist) {
    score += 4;
  } else if (artist && (artist.includes(targetArtist) || targetArtist.includes(artist))) {
    score += 2;
  }
  if (
    targetDuration &&
    typeof entry.duration === "number" &&
    Number.isFinite(entry.duration) &&
    entry.duration > 0
  ) {
    const diff = Math.abs(entry.duration - targetDuration);
    if (diff <= 3) {
      score += 3;
    } else if (diff <= 8) {
      score += 1;
    } else if (diff > 25) {
      score -= 2;
    }
  }
  return score;
}

async function fetchLrclibLyrics(request: SongMetadataEnrichRequest): Promise<string | null> {
  try {
    const getUrl = new URL("https://lrclib.net/api/get");
    getUrl.searchParams.set("track_name", request.title);
    getUrl.searchParams.set("artist_name", request.artist);
    if (request.album) {
      getUrl.searchParams.set("album_name", request.album);
    }
    if (request.duration && request.duration > 0) {
      getUrl.searchParams.set("duration", String(Math.round(request.duration)));
    }
    const exactResponse = await fetch(getUrl, {
      headers: { accept: "application/json", "user-agent": userAgent },
      signal: AbortSignal.timeout(4500),
    });
    if (exactResponse.ok) {
      const exactData: unknown = await exactResponse.json();
      if (isRecord(exactData)) {
        const synced = validSyncedLyrics(exactData.syncedLyrics);
        if (synced) {
          return synced;
        }
      }
    }
  } catch {
    // Fall back to fuzzy search below.
  }

  try {
    const searchUrl = new URL("https://lrclib.net/api/search");
    searchUrl.searchParams.set("track_name", request.title);
    searchUrl.searchParams.set("artist_name", request.artist);
    const searchResponse = await fetch(searchUrl, {
      headers: { accept: "application/json", "user-agent": userAgent },
      signal: AbortSignal.timeout(4500),
    });
    if (!searchResponse.ok) {
      return null;
    }
    const list: unknown = await searchResponse.json();
    if (!Array.isArray(list)) {
      return null;
    }
    const targetTitle = normalizeMetadataKey(request.title);
    const targetArtist = normalizeMetadataKey(request.artist);
    const targetDuration =
      typeof request.duration === "number" && request.duration > 0 ? request.duration : null;

    let bestLyrics: string | null = null;
    let bestScore = 0;
    for (const entry of list) {
      if (!isRecord(entry)) {
        continue;
      }
      const synced = validSyncedLyrics(entry.syncedLyrics);
      if (!synced) {
        continue;
      }
      const score = scoreLrcEntry(entry, targetTitle, targetArtist, targetDuration);
      if (score > bestScore) {
        bestScore = score;
        bestLyrics = synced;
      }
    }
    return bestScore >= 4 ? bestLyrics : null;
  } catch {
    return null;
  }
}

function escapeLucene(value: string) {
  return value
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function joinCredits(names: Set<string>) {
  if (!names.size) {
    return null;
  }
  return Array.from(names).join("、").slice(0, 250);
}

async function fetchMusicBrainzCredits(
  request: SongMetadataEnrichRequest,
): Promise<{ lyricist: string | null; composer: string | null }> {
  const title = escapeLucene(request.title);
  const artist = escapeLucene(request.artist);
  if (!title || !artist) {
    return { lyricist: null, composer: null };
  }
  try {
    const url = new URL("https://musicbrainz.org/ws/2/work");
    url.searchParams.set("query", `work:"${title}" AND artist:"${artist}"`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "5");
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": userAgent },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) {
      return { lyricist: null, composer: null };
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.works)) {
      return { lyricist: null, composer: null };
    }

    for (const work of data.works) {
      if (!isRecord(work)) {
        continue;
      }
      const score = typeof work.score === "number" ? work.score : 0;
      if (score < 80 || !Array.isArray(work.relations)) {
        continue;
      }
      const lyricists = new Set<string>();
      const composers = new Set<string>();
      const writers = new Set<string>();
      for (const relation of work.relations) {
        if (!isRecord(relation) || !isRecord(relation.artist)) {
          continue;
        }
        const type = typeof relation.type === "string" ? relation.type.toLowerCase() : "";
        const name = cleanText(relation.artist.name, 100);
        if (!name) {
          continue;
        }
        if (type === "lyricist") {
          lyricists.add(name);
        } else if (type === "composer") {
          composers.add(name);
        } else if (type === "writer") {
          writers.add(name);
        }
      }
      const lyricist = joinCredits(lyricists.size ? lyricists : writers);
      const composer = joinCredits(composers.size ? composers : writers);
      if (lyricist || composer) {
        return { lyricist, composer };
      }
    }
    return { lyricist: null, composer: null };
  } catch {
    return { lyricist: null, composer: null };
  }
}

function deepSeekEndpoint(baseUrl?: string) {
  const normalized = (baseUrl?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

async function fetchDeepSeekEnrichment(
  request: SongMetadataEnrichRequest,
  config: DeepSeekConfig,
): Promise<{ lyricist: string | null; composer: string | null; description: string | null }> {
  const apiKey = config.deepseekApiKey?.trim();
  if (!apiKey) {
    return { lyricist: null, composer: null, description: null };
  }

  const needCredits = request.needCredits !== false;
  const needDescription = request.needDescription !== false;
  if (!needCredits && !needDescription) {
    return { lyricist: null, composer: null, description: null };
  }

  const songSummary = [
    `歌曲名：${request.title}`,
    `歌手：${request.artist}`,
    request.album ? `专辑：${request.album}` : "",
    request.year ? `发行年份：${request.year}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const instructions = [
    "你是严谨的音乐资料助手，只返回严格 JSON 对象，不要包含 Markdown 代码块或多余文字。",
    'JSON 固定包含字段：{"lyricist": string | null, "composer": string | null, "description": string | null}。',
    needCredits
      ? "lyricist（作词）与 composer（作曲）：仅在你有较高把握确知真实创作者时填写，多人用中文顿号「、」分隔；不确定或纯音乐无作词时填 null，严禁猜测编造。"
      : "lyricist 与 composer 直接返回 null。",
    needDescription
      ? "description（歌曲介绍）：用简体中文写 1 到 3 句简洁客观的简介（背景、风格或专辑信息，180 字以内），如果不了解这首歌则填 null，不要编造。"
      : "description 直接返回 null。",
  ].join("\n");

  try {
    const response = await fetch(deepSeekEndpoint(config.deepseekBaseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.deepseekModel?.trim() || "deepseek-chat",
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: songSummary },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      return { lyricist: null, composer: null, description: null };
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.choices)) {
      return { lyricist: null, composer: null, description: null };
    }
    const firstChoice = payload.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
      return { lyricist: null, composer: null, description: null };
    }
    const rawContent =
      typeof firstChoice.message.content === "string" ? firstChoice.message.content : "";
    const jsonText = rawContent
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed: unknown = JSON.parse(jsonText);
    if (!isRecord(parsed)) {
      return { lyricist: null, composer: null, description: null };
    }
    return {
      lyricist: needCredits ? cleanText(parsed.lyricist, 250) : null,
      composer: needCredits ? cleanText(parsed.composer, 250) : null,
      description: needDescription ? cleanMultilineText(parsed.description, 4000) : null,
    };
  } catch {
    return { lyricist: null, composer: null, description: null };
  }
}

export async function enrichSongMetadata(
  request: SongMetadataEnrichRequest,
  config: DeepSeekConfig,
): Promise<SongMetadataEnrichResult> {
  const [lyrics, credits, ai] = await Promise.all([
    request.needLyrics === false ? Promise.resolve(null) : fetchLrclibLyrics(request),
    request.needCredits === false
      ? Promise.resolve({ lyricist: null, composer: null })
      : fetchMusicBrainzCredits(request),
    fetchDeepSeekEnrichment(request, config),
  ]);

  return {
    lyricist: credits.lyricist ?? ai.lyricist,
    composer: credits.composer ?? ai.composer,
    description: ai.description,
    lyrics,
  };
}
