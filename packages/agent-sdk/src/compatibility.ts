export type SemanticVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: readonly string[];
  build?: readonly string[];
};

const semanticVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const safeVersionNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const parseSemanticVersion = (value: string): SemanticVersion | null => {
  const match = value.match(semanticVersionPattern);
  if (!match) return null;
  const major = safeVersionNumber(match[1] ?? "");
  const minor = safeVersionNumber(match[2] ?? "");
  const patch = safeVersionNumber(match[3] ?? "");
  if (major === null || minor === null || patch === null) return null;
  const prerelease = match[4]?.split(".");
  if (prerelease?.some((identifier) => /^\d+$/.test(identifier) && /^0\d+/.test(identifier))) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    ...(prerelease ? { prerelease } : {}),
    ...(match[5] ? { build: match[5].split(".") } : {}),
  };
};

const comparePrereleaseIdentifiers = (left: string, right: string) => {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
};

export const compareSemanticVersions = (left: SemanticVersion, right: SemanticVersion) => {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
  if (core) return core;
  const leftPrerelease = left.prerelease ?? [];
  const rightPrerelease = right.prerelease ?? [];
  if (!leftPrerelease.length || !rightPrerelease.length) {
    return leftPrerelease.length ? -1 : rightPrerelease.length ? 1 : 0;
  }
  const length = Math.max(leftPrerelease.length, rightPrerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const compared = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (compared) return compared;
  }
  return 0;
};

export const isWorkbenchVersionCompatible = (
  workbenchVersion: string,
  minimumWorkbenchVersion: string,
  maximumWorkbenchVersion?: string,
) => {
  const current = parseSemanticVersion(workbenchVersion);
  const minimum = parseSemanticVersion(minimumWorkbenchVersion);
  const maximum = maximumWorkbenchVersion
    ? parseSemanticVersion(maximumWorkbenchVersion)
    : undefined;
  if (!current || !minimum || (maximumWorkbenchVersion && !maximum)) return false;
  if (maximum && compareSemanticVersions(minimum, maximum) > 0) return false;
  return (
    compareSemanticVersions(current, minimum) >= 0 &&
    (!maximum || compareSemanticVersions(current, maximum) <= 0)
  );
};

export const isPackVersionCompatible = (version: string, range: string) => {
  const parsed = parseSemanticVersion(version);
  const normalized = range.trim();
  if (!parsed || !normalized) return false;
  if (normalized === "*") return true;
  if (normalized.startsWith("^")) {
    const minimum = parseSemanticVersion(normalized.slice(1));
    if (!minimum) return false;
    const maximum =
      minimum.major > 0
        ? { major: minimum.major + 1, minor: 0, patch: 0 }
        : { major: 0, minor: minimum.minor + 1, patch: 0 };
    return (
      compareSemanticVersions(parsed, minimum) >= 0 && compareSemanticVersions(parsed, maximum) < 0
    );
  }
  const exact = parseSemanticVersion(normalized);
  if (exact) return compareSemanticVersions(parsed, exact) === 0;
  const clauses = normalized.split(/\s+/);
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|>|<=|<)(.+)$/);
    if (!match) return false;
    const boundary = parseSemanticVersion(match[2] ?? "");
    if (!boundary) return false;
    const result = compareSemanticVersions(parsed, boundary);
    return match[1] === ">="
      ? result >= 0
      : match[1] === ">"
        ? result > 0
        : match[1] === "<="
          ? result <= 0
          : result < 0;
  });
};
