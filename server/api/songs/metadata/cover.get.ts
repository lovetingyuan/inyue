import {
  createError,
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseHeaders,
} from "h3";
import { requireAccountSession } from "~~/server/utils/account-session";
import { coverMaxBytes } from "~~/shared/library-limits";
import { offlineOwnerHeader } from "~~/shared/offline-library";
import { detectCoverContentType } from "../../../utils/library-upload";
import { isAllowedCoverUrl } from "../../../utils/song-metadata";

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > 0 && buffer.byteLength <= maxBytes ? buffer : null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (!total) {
    return null;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAccountSession(event, { user: { emailVerified: true } });
  setResponseHeader(event, offlineOwnerHeader, user.id);

  const query = getQuery(event);
  const rawUrl = typeof query.url === "string" ? query.url.trim() : "";
  const target = isAllowedCoverUrl(rawUrl);
  if (!target) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_COVER_URL" });
  }

  let response: Response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw createError({ statusCode: 404, statusMessage: "COVER_UNAVAILABLE" });
  }
  if (!response.ok) {
    throw createError({ statusCode: 404, statusMessage: "COVER_UNAVAILABLE" });
  }

  const bytes = await readBoundedBytes(response, coverMaxBytes);
  if (!bytes) {
    throw createError({ statusCode: 413, statusMessage: "COVER_SIZE" });
  }
  const contentType = detectCoverContentType(bytes);
  if (!contentType) {
    throw createError({ statusCode: 415, statusMessage: "UNSUPPORTED_COVER" });
  }

  setResponseHeaders(event, {
    "content-type": contentType,
    "content-length": bytes.byteLength,
    "x-content-type-options": "nosniff",
  });
  return bytes;
});
