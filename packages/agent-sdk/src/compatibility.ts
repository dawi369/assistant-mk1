type Version = { major: number; minor: number; patch: number };

const parseVersion = (value: string): Version | null => {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const compare = (left: Version, right: Version) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

export const isPackVersionCompatible = (version: string, range: string) => {
  const parsed = parseVersion(version);
  const normalized = range.trim();
  if (!parsed || !normalized) return false;
  if (normalized === "*") return true;
  if (normalized.startsWith("^")) {
    const minimum = parseVersion(normalized.slice(1));
    if (!minimum) return false;
    const maximum =
      minimum.major > 0
        ? { major: minimum.major + 1, minor: 0, patch: 0 }
        : { major: 0, minor: minimum.minor + 1, patch: 0 };
    return compare(parsed, minimum) >= 0 && compare(parsed, maximum) < 0;
  }
  const exact = parseVersion(normalized);
  if (exact) return compare(parsed, exact) === 0;
  const clauses = normalized.split(/\s+/);
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|>|<=|<)(.+)$/);
    if (!match) return false;
    const boundary = parseVersion(match[2] ?? "");
    if (!boundary) return false;
    const result = compare(parsed, boundary);
    return match[1] === ">="
      ? result >= 0
      : match[1] === ">"
        ? result > 0
        : match[1] === "<="
          ? result <= 0
          : result < 0;
  });
};
