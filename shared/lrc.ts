import type { LrcLine } from "./types/library";

const timestampPattern = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const inlineWordTagPattern = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g;
const offsetTagPattern = /^\[offset:([+-]?\d+)\]$/i;

function tryDecode(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeLrcBytes(bytes: Uint8Array): string | null {
  if (!bytes.byteLength) {
    return null;
  }
  let text: string | null = null;
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = tryDecode(bytes, "utf-16le");
  } else if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = tryDecode(bytes, "utf-16be");
  } else {
    if (bytes.includes(0)) {
      return null;
    }
    text = tryDecode(bytes, "utf-8") ?? tryDecode(bytes, "gb18030");
  }
  if (!text || text.includes("\0")) {
    return null;
  }
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function parseLrc(raw: string | null | undefined): LrcLine[] {
  if (!raw) {
    return [];
  }
  const source = raw.replace(/^\uFEFF/, "");
  const rawEntries: { time: number; text: string; order: number }[] = [];
  let offsetMs = 0;
  let order = 0;

  for (const rawLine of source.split(/\r\n|\n|\r/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    const offsetMatch = offsetTagPattern.exec(trimmed);
    if (offsetMatch?.[1]) {
      const parsedOffset = Number(offsetMatch[1]);
      if (Number.isFinite(parsedOffset)) {
        offsetMs = parsedOffset;
      }
      continue;
    }

    const timestamps: number[] = [];
    for (const match of rawLine.matchAll(timestampPattern)) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
      timestamps.push(minutes * 60 + seconds + fraction);
    }
    if (!timestamps.length) {
      continue;
    }

    const text = rawLine.replace(timestampPattern, "").replace(inlineWordTagPattern, "").trim();
    if (!text) {
      continue;
    }

    for (const time of timestamps) {
      rawEntries.push({ time, text, order: order++ });
    }
  }

  if (!rawEntries.length) {
    return [];
  }

  const shifted = rawEntries
    .map((entry) => ({
      time: Math.max(0, Math.round((entry.time - offsetMs / 1000) * 1000) / 1000),
      text: entry.text,
      order: entry.order,
    }))
    .sort((a, b) => a.time - b.time || a.order - b.order);

  const lines: LrcLine[] = [];
  for (const entry of shifted) {
    const previous = lines.at(-1);
    if (previous && previous.time === entry.time) {
      if (!previous.lines.includes(entry.text)) {
        previous.lines.push(entry.text);
      }
    } else {
      lines.push({ time: entry.time, lines: [entry.text] });
    }
  }
  return lines;
}

export function findActiveLrcIndex(lines: readonly LrcLine[], currentTime: number): number {
  if (!lines.length || !Number.isFinite(currentTime)) {
    return -1;
  }
  const first = lines[0];
  if (!first || currentTime < first.time) {
    return -1;
  }
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const line = lines[mid];
    if (line && line.time <= currentTime) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}
