import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Result = { label: string; status: "ok" | "warn" | "error"; detail?: string };

const root = process.cwd();
const mobileRoot = join(root, "apps/mobile");
const envPath = join(mobileRoot, ".env.local");
const androidHome = process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");

function command(command: string, args: string[] = []) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function envNames(path: string) {
  if (!existsSync(path)) return new Set<string>();
  return new Set(
    readFileSync(path, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)\s*=/u)?.[1])
      .filter((name): name is string => Boolean(name)),
  );
}

const configured = envNames(envPath);
const results: Result[] = [];
const requireFile = (label: string, path: string) =>
  results.push({ label, status: existsSync(path) ? "ok" : "error" });
const requireCommand = (label: string, executable: string, args: string[] = []) =>
  results.push({ label, status: command(executable, args) !== null ? "ok" : "error" });

requireFile("mobile local environment", envPath);
for (const name of [
  "EXPO_PUBLIC_WORKBENCH_ORIGIN",
  "EXPO_PUBLIC_WORKOS_CLIENT_ID",
  "EXPO_PUBLIC_WORKOS_ISSUER",
] as const) {
  results.push({ label: name, status: configured.has(name) ? "ok" : "error" });
}

if (process.platform === "darwin") {
  requireCommand("Xcode command-line tools", "xcodebuild", ["-version"]);
  const sdks = command("xcodebuild", ["-showsdks"]);
  const runtimes = command("xcrun", ["simctl", "list", "runtimes"]);
  const simulatorSdk = sdks?.match(/-sdk iphonesimulator(\d+\.\d+)/u)?.[1];
  const compatibleRuntime = simulatorSdk
    ? runtimes?.includes(`iOS ${simulatorSdk} (`)
    : Boolean(runtimes?.match(/iOS \d+\.\d+ .* - com\.apple\.CoreSimulator/u));
  results.push({
    label: "compatible iOS simulator runtime",
    status: compatibleRuntime ? "ok" : "error",
    detail: compatibleRuntime
      ? undefined
      : `install the iOS ${simulatorSdk ?? "matching"} runtime in Xcode Settings > Components`,
  });
  requireCommand("CocoaPods", "pod", ["--version"]);
} else {
  results.push({ label: "iOS local builds require macOS", status: "warn" });
}

requireFile("Android adb", join(androidHome, "platform-tools/adb"));
requireFile("Android emulator", join(androidHome, "emulator/emulator"));
const avds = command(join(androidHome, "emulator/emulator"), ["-list-avds"]);
results.push({ label: "Android virtual device", status: avds ? "ok" : "error" });
requireCommand("Java", "java", ["-version"]);

const easIdentity = command(join(mobileRoot, "node_modules/.bin/eas"), ["whoami"]);
results.push({
  label: "optional EAS cloud session",
  status: easIdentity !== null ? "ok" : "warn",
  detail:
    easIdentity !== null
      ? undefined
      : "local builds work without it; run pnpm --filter @assistant-mk1/mobile exec eas login for cloud builds",
});

for (const result of results) {
  console.log(`${result.status} - ${result.label}${result.detail ? ` (${result.detail})` : ""}`);
}

if (results.some((result) => result.status === "error")) process.exitCode = 1;
else console.log("Mobile local development is ready.");
