import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const suites: Array<{ command: string[]; guarantees: string[] }> = [
  {
    command: ["mobile:check"],
    guarantees: [
      "ios-export-bundle",
      "android-export-bundle",
      "native-type-safety",
      "expo-public-config",
    ],
  },
  {
    command: [
      "exec",
      "vitest",
      "run",
      "apps/mobile/src/mobile-foundation.test.ts",
      "apps/mobile/src/chat/chat-transport.test.ts",
      "apps/mobile/src/chat/chat-messages.test.ts",
      "apps/mobile/src/components/generic-renderer-model.test.ts",
      "apps/mobile/src/components/schema-form-model.test.ts",
      "packages/workbench-client/src/chat.test.ts",
      "scripts/mobile-device-evidence-lib.test.ts",
      "cloudflare/control-plane/src/notification-delivery.test.ts",
      "cloudflare/control-plane/src/session-agent-stream.test.ts",
      "cloudflare/control-plane/src/thread-chat-idempotency.test.ts",
      "cloudflare/control-plane/src/agent-connection-token.test.ts",
    ],
    guarantees: [
      "public-config-secret-exclusion-guard",
      "one-pending-turn",
      "durable-send-before-realtime-observation",
      "turn-deduplication",
      "session-replay-ring",
      "stale-token-rejection",
      "generic-pack-route-source-guard",
      "canonical-display-resource-guard",
      "thread-selection-and-hydration-guard",
      "explicit-notification-permission-guard",
      "notification-redaction",
      "invalid-provider-token-classification",
      "formal-terminal-chat-authority",
      "generic-native-rendering",
      "schema-driven-workflow-inputs",
      "strict-device-evidence-contract",
    ],
  },
  {
    command: ["db:cloudflare:migrations:verify"],
    guarantees: ["forward-mobile-migration", "export-purge-schema-parity"],
  },
];

if (process.env.WORKBENCH_MOBILE_DEVICE_EVIDENCE) {
  suites.push({
    command: ["mobile:evidence:check"],
    guarantees: ["same-commit-ios-device", "same-commit-android-device"],
  });
}

const results: Array<{
  command: string;
  durationMs: number;
  status: "passed" | "failed";
  guarantees: string[];
}> = [];
let failed = false;
for (const suite of suites) {
  const started = Date.now();
  const result = spawnSync("pnpm", suite.command, { stdio: "inherit", env: process.env });
  results.push({
    command: `pnpm ${suite.command.join(" ")}`,
    durationMs: Date.now() - started,
    status: result.status === 0 ? "passed" : "failed",
    guarantees: suite.guarantees,
  });
  if (result.status !== 0) {
    failed = true;
    break;
  }
}
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  status: failed ? "failed" : "passed",
  scope: "deterministic-mobile-foundation",
  deviceAcceptance: process.env.WORKBENCH_MOBILE_DEVICE_EVIDENCE ? "passed" : "required-not-run",
  guarantees: results.flatMap((result) => result.guarantees),
  commands: results,
  failureArtifacts: [
    "output/conformance/mobile.json",
    "output/mobile/ios",
    "output/mobile/android",
  ],
};
const directory = resolve(process.cwd(), "output/conformance");
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "mobile.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Mobile conformance ${report.status}.`);
if (failed) process.exitCode = 1;
