import { defineConfig } from "@playwright/test";

const releaseMode = process.env.E2E_RELEASE_MODE;

if (releaseMode !== "signed-out" && releaseMode !== "local-session") {
  throw new Error("E2E_RELEASE_MODE must be signed-out or local-session");
}

const appOrigin = "http://localhost:3100";
const redirectEnv = `NEXT_PUBLIC_WORKOS_REDIRECT_URI=${appOrigin}/auth/callback`;

const frontendCommand =
  releaseMode === "signed-out"
    ? `${redirectEnv} WORKOS_API_KEY='' WORKBENCH_ALLOW_LOCAL_DEV_IDENTITY=false pnpm exec next dev --turbopack -p 3100`
    : `${redirectEnv} WORKOS_API_KEY='' WORKBENCH_ALLOW_LOCAL_DEV_IDENTITY=true WORKBENCH_DEV_USER_ID=e2e-owner WORKBENCH_DEV_WORKSPACE_ID=e2e-workspace WORKBENCH_DEV_AGENT_ID=e2e-agent WORKBENCH_ADMIN_USER_IDS=e2e-owner CLOUDFLARE_CONTROL_PLANE_URL=http://127.0.0.1:8788 pnpm exec next dev --turbopack -p 3100`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  outputDir: "output/playwright/results",
  use: {
    baseURL: appOrigin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    ...(releaseMode === "local-session"
      ? [
          {
            command: "pnpm e2e:serve:worker",
            url: "http://127.0.0.1:8788/health/live",
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]
      : []),
    {
      command: frontendCommand,
      url: `${appOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
