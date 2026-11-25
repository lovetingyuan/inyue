const illegalFilenameCharacters = /[<>:"/\\|?*]/g;
const reservedWindowsNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const audioExtensions: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
};

function stripControlCharacters(value: string) {
  let result = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) {
      result += char;
    }
  }
  return result;
}

export function audioFileExtension(contentType?: string | null) {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return audioExtensions[mime] ?? ".mp3";
}

export function sanitizeSongFilename(title: string, contentType?: string | null) {
  const extension = audioFileExtension(contentType);
  const cleaned = stripControlCharacters(title)
    .replace(illegalFilenameCharacters, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const withoutDuplicateExtension = cleaned.toLowerCase().endsWith(extension)
    ? cleaned.slice(0, -extension.length).replace(/[.\s]+$/g, "")
    : cleaned;
  const bounded = withoutDuplicateExtension.slice(0, 120).replace(/[.\s]+$/g, "");
  const stem = !bounded
    ? "未命名歌曲"
    : reservedWindowsNames.test(bounded)
      ? `${bounded}_`
      : bounded;
  return `${stem}${extension}`;
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}
