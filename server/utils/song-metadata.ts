import { lyricsMaxBytes } from "~~/shared/library-limits";
import { parseLrc } from "~~/shared/lrc";
import type {
  SongMetadataCandidate,
  SongMetadataEnrichRequest,
  SongMetadataEnrichResult,
  SongMetadataSearchResult,
} from "~~/shared/types/song-metadata";

const userAgent = "inYue/1.0 (https://inyue.tingyuan.nz)";
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const allowedCoverHostPattern = /^[a-z0-9-]+\.mzstatic\.com$/i;
const encoder = new TextEncoder();

interface DeepSeekConfig {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

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

function parseYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = /^([1-9]\d{3})/.exec(value.trim());
  return match?.[1] ? Number(match[1]) : null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[\s\-_()[\]（）【】·.,!?，。！？'"’“”]+/g, "");
}

function toHighResCoverUrl(artworkUrl: string | null): string | null {
  if (!artworkUrl) {
    return null;
  }
  const upgraded = artworkUrl.replace(/\/\d+x\d+bb\.(?:jpg|jpeg|png|webp)$/i, "/600x600bb.jpg");
  return isAllowedCoverUrl(upgraded)?.href ?? null;
}

export function isAllowedCoverUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !allowedCoverHostPattern.test(parsed.hostname) ||
      !parsed.pathname.startsWith("/image/")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function fetchItunesRegion(query: string, country: "hk" | "us") {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "8");
  url.searchParams.set("country", country);
  url.searchParams.set("lang", "zh_cn");

  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": userAgent },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    throw new Error(`iTunes ${country} status ${response.status}`);
  }
  const data: unknown = await response.json();
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
        ? String(entry.trackId)
        : `${title}:${artist}`;
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
      coverUrl: toHighResCoverUrl(artworkUrl),
    });
  }
  return items;
}

export async function searchSongMetadata(query: string): Promise<SongMetadataSearchResult> {
  const regions: readonly ("hk" | "us")[] = cjkPattern.test(query) ? ["hk", "us"] : ["us", "hk"];
  const settled = await Promise.allSettled(
    regions.map((country) => fetchItunesRegion(query, country)),
  );
  const fulfilled = settled.filter(
    (item): item is PromiseFulfilledResult<SongMetadataCandidate[]> => item.status === "fulfilled",
  );
  if (!fulfilled.length) {
    return { items: [], unavailable: true };
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const merged: SongMetadataCandidate[] = [];
  for (const result of fulfilled) {
    for (const candidate of result.value) {
      const signature = `${normalizeKey(candidate.title)}|${normalizeKey(candidate.artist)}|${normalizeKey(candidate.album ?? "")}`;
      if (seenIds.has(candidate.id) || seenKeys.has(signature)) {
        continue;
      }
      seenIds.add(candidate.id);
      seenKeys.add(signature);
      merged.push(candidate);
      if (merged.length >= 10) {
        return { items: merged };
      }
    }
  }
  return { items: merged };
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
  const title = typeof entry.trackName === "string" ? normalizeKey(entry.trackName) : "";
  const artist = typeof entry.artistName === "string" ? normalizeKey(entry.artistName) : "";
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
    const targetTitle = normalizeKey(request.title);
    const targetArtist = normalizeKey(request.artist);
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
