export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isValidSemver(version: string): boolean {
  return SEMVER_RE.test(version);
}

export function parseSemver(version: string): ParsedSemver {
  const match = version.match(SEMVER_RE);
  if (!match) {
    throw new Error(
      `Invalid semver: "${version}". Expected format: major.minor.patch`
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

export function latestVersion(versions: string[]): string {
  if (versions.length === 0) {
    throw new Error('Cannot determine latest version from empty array');
  }
  return versions.reduce((latest, v) =>
    compareSemver(v, latest) > 0 ? v : latest
  );
}
