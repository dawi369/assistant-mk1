import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import compatibility from "../config/mobile-native-compatibility.json";

export type NativeMismatch = {
  package: string;
  current: string;
  expected: string;
};

type DeferredMismatch = NativeMismatch & { reviewAfter: string };

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
