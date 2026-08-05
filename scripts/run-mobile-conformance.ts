import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const suites = [
  {
    command: ["mobile:check"],
    guarantees: ["ios-bundle", "android-bundle", "native-type-safety", "expo-public-config"],
  },
  {
    command: [
      "exec",
      "vitest",
      "run",
      "apps/mobile/src/mobile-foundation.test.ts",
      "cloudflare/control-plane/src/notification-delivery.test.ts",
      "cloudflare/control-plane/src/session-agent-stream.test.ts",
      "cloudflare/control-plane/src/thread-chat-idempotency.test.ts",
      "cloudflare/control-plane/src/agent-connection-token.test.ts",
    ],
    guarantees: [
      "secure-token-custody",
      "one-pending-turn",
      "turn-deduplication",
      "cursor-reset",
      "stale-token-rejection",
      "generic-pack-ui",
      "notification-redaction",
      "invalid-provider-token-classification",
    ],
  },
  {
    command: ["db:cloudflare:migrations:verify"],
    guarantees: ["forward-mobile-migration", "export-purge-schema-parity"],
  },
] as const;

const results: Array<{
  command: string;
  durationMs: number;
  status: "passed" | "failed";
  guarantees: readonly string[];
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
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  status: failed ? "failed" : "passed",
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
