import { githubRepoSlug, githubRepositoryUrl } from "~~/shared/app-brand";
import { normalizeVersion } from "~~/shared/app-version";
import type { AppReleaseInfo, ReleaseNoteBlock } from "~~/shared/types/app-release";

const requestTimeoutMs = 8_000;
const cacheHitTtlMs = 5 * 60_000;
const cacheMissTtlMs = 60_000;
const githubOrigin = "https://github.com";
const githubHeaders = {
  "user-agent": "inYue-App",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

interface CachedRelease {
  value: AppReleaseInfo | null;
  expiresAt: number;
}

interface ParsedAtomEntry {
  title: string;
  publishedAt: string | null;
  contentHtml: string;
}

interface ParsedApkAsset {
  url: string;
  name: string;
  size: string | null;
}

let cachedRelease: CachedRelease | undefined;
let inflightFetch: Promise<AppReleaseInfo | null> | undefined;

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

function stripInlineTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseReleaseNotesHtml(rawHtml: string): ReleaseNoteBlock[] {
  const cleaned = rawHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .trim();
  if (!cleaned) {
    return [];
  }

  const blocks: ReleaseNoteBlock[] = [];
  const blockPattern =
    /<(h[1-6]|p|ul|ol|pre|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  for (const match of cleaned.matchAll(blockPattern)) {
    const tag = match[1]?.toLowerCase();
    const inner = match[2] ?? "";
    if (!tag) {
      continue;
    }

    if (tag.startsWith("h")) {
      const text = stripInlineTags(inner);
      if (text) {
        blocks.push({ type: "heading", text });
      }
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      for (const liMatch of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const text = stripInlineTags(liMatch[1] ?? "");
        if (text) {
          items.push(text);
        }
      }
      if (items.length) {
        blocks.push({ type: "list", ordered: tag === "ol", items });
      }
      continue;
    }

    if (tag === "pre") {
      const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).trim();
      if (text) {
        blocks.push({ type: "code", text });
      }
      continue;
    }

    const text = stripInlineTags(inner);
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
  }

  if (!blocks.length) {
    const fallbackText = stripInlineTags(cleaned);
    for (const line of fallbackText.split(/\n{2,}/)) {
      const trimmed = line.trim();
      if (trimmed) {
        blocks.push({ type: "paragraph", text: trimmed });
      }
    }
  }

  return blocks;
}

function extractTagFromReleaseUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, githubOrigin);
    if (url.origin !== githubOrigin) {
      return null;
    }
    const prefix = `/${githubRepoSlug}/releases/tag/`.toLowerCase();
    if (!url.pathname.toLowerCase().startsWith(prefix)) {
      return null;
    }
    const rawTag = url.pathname.slice(prefix.length).replace(/\/+$/, "");
    if (!rawTag || rawTag.includes("/")) {
      return null;
    }
    return decodeURIComponent(rawTag);
  } catch {
    return null;
  }
}

function parseAtomEntryForTag(atomXml: string, tag: string): ParsedAtomEntry | null {
  const normalizedTarget = tag.toLowerCase();
  for (const match of atomXml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1] ?? "";
    const hrefMatch = entry.match(/<link\b[^>]*href="([^"]+)"/i);
    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/i);
    const entryTag =
      (hrefMatch?.[1] ? extractTagFromReleaseUrl(decodeHtmlEntities(hrefMatch[1])) : null) ??
      (idMatch?.[1] ? decodeURIComponent(idMatch[1].trim().split("/").at(-1) ?? "") : null);
    if (!entryTag || entryTag.toLowerCase() !== normalizedTarget) {
      continue;
    }
    const titleMatch = entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const updatedMatch = entry.match(/<updated>([\s\S]*?)<\/updated>/i);
    const contentMatch = entry.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i);
    return {
      title: titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]).trim() : tag,
      publishedAt: updatedMatch?.[1]?.trim() || null,
      contentHtml: contentMatch?.[1] ? decodeHtmlEntities(contentMatch[1]) : "",
    };
  }
  return null;
}

function parseApkAssetFromHtml(assetsHtml: string, tag: string): ParsedApkAsset | null {
  const expectedPrefix = `/${githubRepoSlug}/releases/download/`.toLowerCase();
  const preferredName = `inyue-${tag}.apk`.toLowerCase();
  const candidates: ParsedApkAsset[] = [];

  for (const liMatch of assetsHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const itemHtml = liMatch[1] ?? "";
    const hrefMatch = itemHtml.match(/<a\b[^>]*href="([^"]+\.apk)"/i);
    const rawHref = hrefMatch?.[1] ? decodeHtmlEntities(hrefMatch[1]) : "";
    if (!rawHref) {
      continue;
    }
    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(rawHref, githubOrigin);
    } catch {
      continue;
    }
    if (
      resolvedUrl.origin !== githubOrigin ||
      !resolvedUrl.pathname.toLowerCase().startsWith(expectedPrefix)
    ) {
      continue;
    }
    const rawName = resolvedUrl.pathname.split("/").at(-1) ?? "";
    const name = decodeURIComponent(rawName);
    if (!name.toLowerCase().endsWith(".apk")) {
      continue;
    }
    const sizeMatch = itemHtml.match(/>\s*(\d+(?:\.\d+)?\s*(?:Bytes|B|KB|MB|GB|KiB|MiB|GiB))\s*</i);
    candidates.push({
      url: resolvedUrl.href,
      name,
      size: sizeMatch?.[1]?.trim() ?? null,
    });
  }

  if (!candidates.length) {
    return null;
  }
  return (
    candidates.find((item) => item.name.toLowerCase() === preferredName) ??
    candidates[0] ??
    null
  );
}

function parseReleasePageFallback(html: string): string {
  const bodyMatch = html.match(
    /<div\b[^>]*class="[^"]*\bmarkdown-body\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  return bodyMatch?.[1] ?? "";
}

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: githubHeaders,
    redirect: "follow",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    return null;
  }
  return response.text();
}

async function fetchLatestReleaseFromGitHub(): Promise<AppReleaseInfo | null> {
  const latestResponse = await fetch(`${githubRepositoryUrl}/releases/latest`, {
    headers: githubHeaders,
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  const redirectLocation = latestResponse.headers.get("location");
  const tag =
    (redirectLocation ? extractTagFromReleaseUrl(redirectLocation) : null) ??
    (latestResponse.ok ? extractTagFromReleaseUrl(latestResponse.url) : null);

  if (!tag) {
    return null;
  }

  const encodedTag = encodeURIComponent(tag);
  const releaseUrl = `${githubRepositoryUrl}/releases/tag/${encodedTag}`;

  const [atomXml, assetsHtml] = await Promise.all([
    fetchText(`${githubRepositoryUrl}/releases.atom`).catch(() => null),
    fetchText(`${githubRepositoryUrl}/releases/expanded_assets/${encodedTag}`).catch(() => null),
  ]);

  const atomEntry = atomXml ? parseAtomEntryForTag(atomXml, tag) : null;
  let notesHtml = atomEntry?.contentHtml ?? "";
  if (!notesHtml.trim()) {
    const releasePageHtml = await fetchText(releaseUrl).catch(() => null);
    if (releasePageHtml) {
      notesHtml = parseReleasePageFallback(releasePageHtml);
    }
  }

  const apk = assetsHtml ? parseApkAssetFromHtml(assetsHtml, tag) : null;

  return {
    tag,
    version: normalizeVersion(tag),
    title: atomEntry?.title || tag,
    publishedAt: atomEntry?.publishedAt ?? null,
    releaseUrl,
    apkUrl: apk?.url ?? null,
    apkName: apk?.name ?? null,
    apkSize: apk?.size ?? null,
    notes: parseReleaseNotesHtml(notesHtml),
  };
}

export async function getLatestGitHubRelease(): Promise<AppReleaseInfo | null> {
  const now = Date.now();
  if (cachedRelease && cachedRelease.expiresAt > now) {
    return cachedRelease.value;
  }
  if (!inflightFetch) {
    inflightFetch = fetchLatestReleaseFromGitHub()
      .then((release) => {
        cachedRelease = {
          value: release,
          expiresAt: Date.now() + (release ? cacheHitTtlMs : cacheMissTtlMs),
        };
        return release;
      })
      .catch(() => {
        if (cachedRelease) {
          cachedRelease = {
            value: cachedRelease.value,
            expiresAt: Date.now() + cacheMissTtlMs,
          };
          return cachedRelease.value;
        }
        return null;
      })
      .finally(() => {
        inflightFetch = undefined;
      });
  }
  return inflightFetch;
}
