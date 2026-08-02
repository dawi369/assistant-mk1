import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type LocalEnvironment = Record<string, string>;

export const parseLocalEnvironment = (source: string): LocalEnvironment => {
  const values: LocalEnvironment = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

export const readLocalEnvironment = (root: string, path: string) => {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return null;
  return parseLocalEnvironment(readFileSync(absolute, "utf8"));
};
