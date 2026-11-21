interface CoverObjectUrlEntry {
  url: string;
  refs: number;
}

const entries = new Map<string, CoverObjectUrlEntry>();

function entryKey(scope: string, coverId: string) {
  return `${scope}/${coverId}`;
}

export function retainCoverObjectUrl(scope: string, coverId: string, blob?: Blob) {
  const key = entryKey(scope, coverId);
  const existing = entries.get(key);
  if (existing) {
    existing.refs++;
    return existing.url;
  }
  if (!blob) {
    return;
  }
  const url = URL.createObjectURL(blob);
  entries.set(key, { url, refs: 1 });
  return url;
}

export function releaseCoverObjectUrl(scope: string, coverId: string) {
  const key = entryKey(scope, coverId);
  const existing = entries.get(key);
  if (!existing) {
    return;
  }
  existing.refs--;
  if (existing.refs <= 0) {
    entries.delete(key);
    URL.revokeObjectURL(existing.url);
  }
}
