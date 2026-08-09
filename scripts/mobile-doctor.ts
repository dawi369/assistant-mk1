import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Result = { label: string; status: "ok" | "warn" | "error"; detail?: string };
type Target = "auto" | "ios-device" | "ios-simulator" | "android" | "cloud";

const root = process.cwd();
const mobileRoot = join(root, "apps/mobile");
const envPath = join(mobileRoot, ".env.local");
const androidHome = process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");
const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
const target = (targetArgument?.slice("--target=".length) || "auto") as Target;
if (!["auto", "ios-device", "ios-simulator", "android", "cloud"].includes(target)) {
  throw new Error(`Unsupported mobile doctor target: ${target}`);
}

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
const requireFile = (label: string, path: string, required = true) =>
  results.push({ label, status: existsSync(path) ? "ok" : required ? "error" : "warn" });
const requireCommand = (label: string, executable: string, args: string[] = [], required = true) =>
  results.push({
    label,
    status: command(executable, args) !== null ? "ok" : required ? "error" : "warn",
  });

requireFile("mobile local environment", envPath);
for (const name of [
  "EXPO_PUBLIC_WORKBENCH_ORIGIN",
  "EXPO_PUBLIC_WORKOS_CLIENT_ID",
  "EXPO_PUBLIC_WORKOS_ISSUER",
] as const) {
  results.push({ label: name, status: configured.has(name) ? "ok" : "error" });
}

if (process.platform === "darwin") {
  const requireIos = target === "ios-device" || target === "ios-simulator";
  requireCommand("Xcode command-line tools", "xcodebuild", ["-version"], requireIos);
  const sdks = command("xcodebuild", ["-showsdks"]);
  const runtimes = command("xcrun", ["simctl", "list", "runtimes"]);
  const simulatorSdk = sdks?.match(/-sdk iphonesimulator(\d+\.\d+)/u)?.[1];
  const compatibleRuntime = simulatorSdk
    ? runtimes?.includes(`iOS ${simulatorSdk} (`)
    : Boolean(runtimes?.match(/iOS \d+\.\d+ .* - com\.apple\.CoreSimulator/u));
  results.push({
    label: "compatible iOS simulator runtime",
    status: compatibleRuntime ? "ok" : target === "ios-simulator" ? "error" : "warn",
    detail: compatibleRuntime
      ? undefined
      : `install the iOS ${simulatorSdk ?? "matching"} runtime in Xcode Settings > Components`,
  });
  requireCommand("CocoaPods", "pod", ["--version"], requireIos);
  requireCommand(
    "iOS devicectl availability",
    "xcrun",
    ["devicectl", "list", "devices"],
    target === "ios-device",
  );
} else {
  results.push({
    label: "iOS local builds require macOS",
    status: target === "ios-device" || target === "ios-simulator" ? "error" : "warn",
  });
}

const requireAndroid = target === "android";
requireFile("Android adb", join(androidHome, "platform-tools/adb"), requireAndroid);
requireFile("Android emulator", join(androidHome, "emulator/emulator"), requireAndroid);
const avds = command(join(androidHome, "emulator/emulator"), ["-list-avds"]);
results.push({
  label: "Android virtual device",
  status: avds ? "ok" : requireAndroid ? "error" : "warn",
});
requireCommand("Java", "java", ["-version"], requireAndroid);

const easExecutable = join(mobileRoot, "node_modules/.bin/eas");
const easIdentity = target === "cloud" ? command(easExecutable, ["whoami"]) : null;
results.push({
  label: target === "cloud" ? "EAS cloud session" : "optional EAS cloud CLI",
  status:
    target === "cloud"
      ? easIdentity !== null
        ? "ok"
        : "error"
      : existsSync(easExecutable)
        ? "ok"
        : "warn",
  detail:
    target !== "cloud" || easIdentity !== null
      ? undefined
      : "local builds work without it; run pnpm --filter @assistant-mk1/mobile exec eas login for cloud builds",
});

for (const result of results) {
  console.log(`${result.status} - ${result.label}${result.detail ? ` (${result.detail})` : ""}`);
}

if (results.some((result) => result.status === "error")) process.exitCode = 1;
else console.log(`Mobile ${target === "auto" ? "development" : target} prerequisites are ready.`);
