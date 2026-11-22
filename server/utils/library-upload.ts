import { createError, getRequestHeader, readMultipartFormData } from "h3";
import { decodeLrcBytes, parseLrc } from "../../shared/lrc";
import {
  audioMaxBytes,
  coverMaxBytes,
  lyricsMaxBytes,
  uploadMaxBytes,
} from "../../shared/library-limits";
import type { H3Event, MultiPartData } from "h3";

export async function uploadForm(event: H3Event, maxBytes = uploadMaxBytes) {
  const size = Number(getRequestHeader(event, "content-length"));
  if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: "UPLOAD_SIZE" });
  }
  const parts = await readMultipartFormData(event);
  if (
    !parts ||
    parts.some(({ name }) => !name) ||
    new Set(parts.map(({ name }) => name)).size !== parts.length
  ) {
    throw createError({ statusCode: 400, statusMessage: "INVALID_FORM" });
  }
  return new Map(parts.map((part) => [part.name, part]));
}

export function formText(
  form: Awaited<ReturnType<typeof uploadForm>>,
  name: string,
  length: number,
  required = false,
) {
  const part = form.get(name);
  const value = part && !part.filename ? part.data.toString("utf8").trim() : "";
  if ((required && !value) || value.length > length) {
    throw createError({
      statusCode: 400,
      statusMessage: "INVALID_METADATA",
      data: { field: name, reason: value ? "length" : "required" },
    });
  }
  return value || null;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const ihdrSignature = [0x49, 0x48, 0x44, 0x52] as const;

function hasBytesAt(data: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((byte, index) => data[offset + index] === byte);
}

function asciiAt(data: Uint8Array, start: number, end: number) {
  let result = "";
  for (let index = start; index < end; index++) {
    result += String.fromCharCode(data[index] ?? 0);
  }
  return result;
}

export function detectCoverContentType(data: Uint8Array) {
  const jpeg = data.length > 8 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png =
    data.length >= 33 && hasBytesAt(data, 0, pngSignature) && hasBytesAt(data, 12, ihdrSignature);
  const webp =
    data.length >= 20 &&
    asciiAt(data, 0, 4) === "RIFF" &&
    asciiAt(data, 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(asciiAt(data, 12, 16));
  return jpeg ? "image/jpeg" : png ? "image/png" : webp ? "image/webp" : null;
}

export function coverUpload(part?: MultiPartData) {
  if (!part) {
    return null;
  }
  const { data } = part;
  if (data.length > coverMaxBytes) {
    throw createError({ statusCode: 413, statusMessage: "COVER_SIZE" });
  }
  const contentType = detectCoverContentType(data);
  if (!part.filename || !contentType) {
    throw createError({ statusCode: 415, statusMessage: "UNSUPPORTED_COVER" });
  }
  return { data, contentType };
}

export async function audioUpload(part?: MultiPartData) {
  if (!part?.filename || !part.data.length) {
    throw createError({ statusCode: 400, statusMessage: "MISSING_AUDIO" });
  }
  if (part.data.length > audioMaxBytes) {
    throw createError({ statusCode: 413, statusMessage: "AUDIO_SIZE" });
  }
  const { parseBuffer } = await import("music-metadata");
  const { format } = await parseBuffer(part.data, undefined, {
    skipCovers: true,
    duration: true,
  }).catch(() => ({ format: null }));
  if (
    !format ||
    !/^MPEG .+ Layer 3$/.test(format.codec ?? "") ||
    format.container !== "MPEG" ||
    !format.sampleRate
  ) {
    throw createError({ statusCode: 415, statusMessage: "UNSUPPORTED_AUDIO" });
  }
  return { data: part.data, contentType: "audio/mpeg", duration: format.duration ?? null };
}

export function lyricsUpload(part?: MultiPartData) {
  if (!part) {
    return null;
  }
  if (!part.filename || !part.data.length) {
    throw createError({ statusCode: 415, statusMessage: "UNSUPPORTED_LYRICS" });
  }
  if (part.data.length > lyricsMaxBytes) {
    throw createError({ statusCode: 413, statusMessage: "LYRICS_SIZE" });
  }
  const text = decodeLrcBytes(part.data);
  if (!text || !parseLrc(text).length) {
    throw createError({ statusCode: 415, statusMessage: "UNSUPPORTED_LYRICS" });
  }
  return text;
}
