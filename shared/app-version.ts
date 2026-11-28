const semverPattern =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/i;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(raw: string): ParsedVersion | null {
  const match = raw.trim().match(semverPattern);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return 0;
  }
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) {
    return 0;
  }
  if (!left.prerelease.length) {
    return 1;
  }
  if (!right.prerelease.length) {
    return -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index++) {
    const partA = left.prerelease[index];
    const partB = right.prerelease[index];
    if (partA === undefined) {
      return -1;
    }
    if (partB === undefined) {
      return 1;
    }
    if (partA === partB) {
      continue;
    }
    const numA = /^\d+$/.test(partA);
    const numB = /^\d+$/.test(partB);
    if (numA && numB) {
      return Number(partA) > Number(partB) ? 1 : -1;
    }
    if (numA) {
      return -1;
    }
    if (numB) {
      return 1;
    }
    return partA > partB ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
