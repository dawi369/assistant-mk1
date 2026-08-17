import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const platform = process.argv[2];
if (platform !== "ios" && platform !== "android") throw new Error("Expected ios|android.");
const journey = process.argv[3] ?? process.env.MOBILE_E2E_JOURNEY ?? "hosted";
if (journey !== "hosted" && journey !== "signed-out") {
  throw new Error("Expected journey hosted|signed-out.");
}
const flow = resolve(
  process.cwd(),
  process.env.MOBILE_E2E_FLOW ?? `tests/mobile/${platform}-${journey}.yaml`,
);
if (!existsSync(flow)) throw new Error(`Mobile flow is missing: ${flow}`);
const artifactDirectory = resolve(process.cwd(), `output/mobile/${platform}/${journey}`);
mkdirSync(artifactDirectory, { recursive: true });
const appId = process.env.MOBILE_E2E_APP_ID ?? "com.dawi369.assistantmk1";
const message = process.env.MOBILE_E2E_MESSAGE ?? `mobile-smoke-${Date.now()}`;

if (platform === "android" && journey === "signed-out") {
  const androidHome = process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");
  const adb = join(androidHome, "platform-tools/adb");
  const commands = [
    ["shell", "pm", "clear", appId],
    ["reverse", "tcp:8081", "tcp:8081"],
    [
      "shell",
      "am",
      "start",
      "-W",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "exp+assistant-mk1://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
      appId,
    ],
  ];
  for (const args of commands) {
    const prepared = spawnSync(adb, args, { stdio: "inherit" });
    if (prepared.status !== 0) throw new Error(`Android test preparation failed: adb ${args[0]}`);
  }
}
const result = spawnSync(
  "maestro",
  [
    "test",
    "--env",
    `MOBILE_E2E_APP_ID=${appId}`,
    "--env",
    `MOBILE_E2E_MESSAGE=${message}`,
    "--format",
    "junit",
    "--output",
    resolve(artifactDirectory, "report.xml"),
    "--test-output-dir",
    artifactDirectory,
    flow,
  ],
  {
    stdio: "inherit",
    env: process.env,
  },
);
if (result.error && "code" in result.error && result.error.code === "ENOENT") {
  throw new Error("Maestro is required for native device journeys: https://maestro.mobile.dev");
}
if (result.status !== 0) process.exit(result.status ?? 1);
