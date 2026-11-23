type LinkifyTextSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string };

const urlPattern =
  /(?:https?:\/\/|(?<![a-zA-Z0-9_@./-])www\.)[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d{1,5})?(?:[/?#][^\s<>"`\u2014\u2018-\u201F\u2026\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]*)?/gi;

const trailingPunctuation = new Set([".", ",", ";", ":", "!", "?", "'", '"', "*"]);

const matchingOpenBracket: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function countOccurrences(text: string, char: string) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char) {
      count++;
    }
  }
  return count;
}

function trimTrailingPunctuation(raw: string) {
  let value = raw;
  while (value.length > 0) {
    const last = value.at(-1);
    if (!last) {
      break;
    }
    if (trailingPunctuation.has(last)) {
      value = value.slice(0, -1);
      continue;
    }
    const open = matchingOpenBracket[last];
    if (open && countOccurrences(value, last) > countOccurrences(value, open)) {
      value = value.slice(0, -1);
      continue;
    }
    break;
  }
  return value;
}

function parseHttpUrl(raw: string) {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      !parsed.hostname.includes(".")
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function appendText(segments: LinkifyTextSegment[], text: string) {
  if (!text) {
    return;
  }
  const previous = segments.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
  } else {
    segments.push({ type: "text", text });
  }
}

export function linkifyText(input: string): LinkifyTextSegment[] {
  const segments: LinkifyTextSegment[] = [];
  let cursor = 0;

  for (const match of input.matchAll(urlPattern)) {
    const index = match.index;
    const raw = match[0];
    const text = trimTrailingPunctuation(raw);
    const href = text ? parseHttpUrl(text) : null;

    if (!href) {
      appendText(segments, input.slice(cursor, index + raw.length));
      cursor = index + raw.length;
      continue;
    }

    appendText(segments, input.slice(cursor, index));
    segments.push({ type: "link", text, href });
    cursor = index + text.length;
  }

  appendText(segments, input.slice(cursor));
  return segments;
}
