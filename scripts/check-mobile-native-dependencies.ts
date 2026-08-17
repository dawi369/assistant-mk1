import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import compatibility from "../config/mobile-native-compatibility.json";

export type NativeMismatch = {
  package: string;
  current: string;
  expected: string;
};

type DeferredMismatch = NativeMismatch & { reviewAfter: string };

type NumericVersion = {
  major: number;
  minor: number;
  patch: number;
};

const parseNumericVersion = (value: string): NumericVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

const compareNumericVersions = (left: NumericVersion, right: NumericVersion) =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

export const satisfiesCaretRange = (version: string, range: string) => {
  const parsedVersion = parseNumericVersion(version);
  const minimum = range.startsWith("^") ? parseNumericVersion(range.slice(1)) : null;
  if (!parsedVersion || !minimum || compareNumericVersions(parsedVersion, minimum) < 0) {
    return false;
  }
  const upperExclusive =
    minimum.major > 0
      ? { major: minimum.major + 1, minor: 0, patch: 0 }
      : minimum.minor > 0
        ? { major: 0, minor: minimum.minor + 1, patch: 0 }
        : { major: 0, minor: 0, patch: minimum.patch + 1 };
  return compareNumericVersions(parsedVersion, upperExclusive) < 0;
};

const resolvePackageJson = (specifier: string, from: string) => {
  const require = createRequire(realpathSync(from));
  const entry = realpathSync(require.resolve(specifier));
  let directory = entry;
  while (directory !== "/") {
    const candidate = `${directory}/package.json`;
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as {
        version: string;
        dependencies?: Record<string, string>;
      };
    } catch {
      directory = directory.slice(0, directory.lastIndexOf("/")) || "/";
    }
  }
  throw new Error(`Could not resolve package metadata for ${specifier}.`);
};

export const checkAssistantUiNativeRuntime = () => {
  const nativePackagePath = "apps/mobile/node_modules/@assistant-ui/react-native/package.json";
  const nativePackage = JSON.parse(readFileSync(nativePackagePath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const requiredTap = nativePackage.dependencies?.["@assistant-ui/tap"];
  const resolvedTap = resolvePackageJson("@assistant-ui/tap", nativePackagePath);
  if (!requiredTap || !satisfiesCaretRange(resolvedTap.version, requiredTap)) {
    throw new Error(
      `Incompatible assistant-ui native runtime: @assistant-ui/tap@${resolvedTap.version} does not satisfy ${requiredTap ?? "the declared range"}.`,
    );
  }
};

export const checkSentryBuildCli = () => {
  const mobilePackagePath = "apps/mobile/package.json";
  const mobilePackage = JSON.parse(readFileSync(mobilePackagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const sentryPackage = resolvePackageJson(
    "@sentry/react-native/package.json",
    mobilePackagePath,
  );
  const requiredCli = sentryPackage.dependencies?.["@sentry/cli"];
  const declaredCli = mobilePackage.devDependencies?.["@sentry/cli"];
  if (!requiredCli || declaredCli !== requiredCli) {
    throw new Error(
      `The mobile package must declare @sentry/cli@${requiredCli ?? "the React Native SDK version"} directly so pnpm builds can resolve the Xcode upload phase.`,
    );
  }
  const resolvedCli = resolvePackageJson("@sentry/cli/package.json", mobilePackagePath);
  if (resolvedCli.version !== requiredCli) {
    throw new Error(
      `Incompatible Sentry build CLI: resolved ${resolvedCli.version}, expected ${requiredCli}.`,
    );
  }
};

export const parseNativeMismatches = (output: string): NativeMismatch[] =>
  [...output.matchAll(/^\s{2}(.+)@([^\s]+) - expected version: ([^\s]+)$/gmu)].map(
    ([, packageName, current, expected]) => ({
      package: packageName.trim(),
      current,
      expected,
    }),
  );

export const validateNativeMismatches = (
  actual: NativeMismatch[],
  deferred: DeferredMismatch[],
  now = new Date(),
) => {
  const allowed = new Map(
    deferred.map((item) => [`${item.package}@${item.current}->${item.expected}`, item]),
  );
  const unexpected = actual.filter(
    (item) => !allowed.has(`${item.package}@${item.current}->${item.expected}`),
  );
  if (unexpected.length) {
    throw new Error(
      `Unsupported native dependency drift:\n${unexpected
        .map((item) => `${item.package}@${item.current} (expected ${item.expected})`)
        .join("\n")}`,
    );
  }
  const actualKeys = new Set(
    actual.map((item) => `${item.package}@${item.current}->${item.expected}`),
  );
  const expired = deferred.filter(
    (item) =>
      actualKeys.has(`${item.package}@${item.current}->${item.expected}`) &&
      now >= new Date(item.reviewAfter),
  );
  if (expired.length) {
    throw new Error(
      `Native patch deferral expired:\n${expired
        .map((item) => `${item.package}: update to ${item.expected}`)
        .join("\n")}`,
    );
  }
};

export const checkMobileNativeDependencies = () => {
  checkAssistantUiNativeRuntime();
  checkSentryBuildCli();
  const result = spawnSync(
    "pnpm",
    ["--filter", "@assistant-mk1/mobile", "exec", "expo", "install", "--check"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.log("Expo native dependencies match the supported SDK matrix.");
    return;
  }
  const mismatches = parseNativeMismatches(output);
  if (!mismatches.length) {
    throw new Error("Expo dependency validation failed without a recognized mismatch report.");
  }
  validateNativeMismatches(mismatches, compatibility.deferredPatchMismatches);
  console.log(
    `Expo dependency matrix is supported with ${mismatches.length} time-bounded patch deferral(s).`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) checkMobileNativeDependencies();
