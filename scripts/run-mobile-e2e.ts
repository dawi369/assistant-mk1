import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const platform = process.argv[2];
if (platform !== "ios" && platform !== "android") throw new Error("Expected ios|android.");
const flow = resolve(
  process.cwd(),
  process.env.MOBILE_E2E_FLOW ?? `tests/mobile/${platform}-hosted.yaml`,
);
if (!existsSync(flow)) throw new Error(`Mobile flow is missing: ${flow}`);
const result = spawnSync("maestro", ["test", flow], {
  stdio: "inherit",
  env: {
    ...process.env,
    MOBILE_E2E_APP_ID: process.env.MOBILE_E2E_APP_ID ?? "com.dawi369.assistantmk1",
  },
});
if (result.error && "code" in result.error && result.error.code === "ENOENT") {
  throw new Error("Maestro is required for native device journeys: https://maestro.mobile.dev");
}
if (result.status !== 0) process.exit(result.status ?? 1);
