import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
const result = spawnSync(
  "maestro",
  [
    "test",
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
    env: {
      ...process.env,
      MOBILE_E2E_APP_ID: process.env.MOBILE_E2E_APP_ID ?? "com.dawi369.assistantmk1",
    },
  },
);
if (result.error && "code" in result.error && result.error.code === "ENOENT") {
  throw new Error("Maestro is required for native device journeys: https://maestro.mobile.dev");
}
if (result.status !== 0) process.exit(result.status ?? 1);
