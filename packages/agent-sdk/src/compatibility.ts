export type SemanticVersion = { major: number; minor: number; patch: number };

export const parseSemanticVersion = (value: string): SemanticVersion | null => {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const compareSemanticVersions = (left: SemanticVersion, right: SemanticVersion) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

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
