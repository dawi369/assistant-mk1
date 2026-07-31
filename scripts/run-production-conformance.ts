import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Domain = "data-lifecycle" | "connections" | "actions";
type Suite = { command: string[]; guarantees: string[] };

const suites: Record<Domain, Suite[]> = {
  "data-lifecycle": [
    {
      command: ["db:cloudflare:migrations:verify"],
      guarantees: ["forward-migrations", "schema-parity"],
    },
    {
      command: [
        "exec",
        "vitest",
        "run",
        "cloudflare/control-plane/src/artifact-lifecycle.test.ts",
        "cloudflare/control-plane/src/workspace-data-lifecycle.test.ts",
        "cloudflare/control-plane/src/zip-archive.test.ts",
      ],
      guarantees: [
        "retention-bounds",
        "complete-export",
        "quarantine-recovery",
        "tenant-scoped-purge",
      ],
    },
    {
      command: ["test:service-boundaries:data-lifecycle"],
      guarantees: [
        "async-export-download",
        "retention-confirmation",
        "quarantine-access-fence",
        "recovery",
        "cross-tenant-export-denial",
      ],
    },
  ],
  connections: [
    {
      command: [
        "exec",
        "vitest",
        "run",
        "cloudflare/control-plane/src/credential-vault.test.ts",
        "cloudflare/control-plane/src/connection-providers.test.ts",
        "cloudflare/control-plane/src/connection-auth.test.ts",
      ],
      guarantees: [
        "vault-isolation",
        "oauth-pkce",
        "provider-egress-policy",
        "credential-redaction",
      ],
    },
  ],
  actions: [
    {
      command: [
        "exec",
        "vitest",
        "run",
        "scripts/agent-pack-compiler.test.ts",
        "cloudflare/control-plane/src/approval-transitions.test.ts",
        "cloudflare/control-plane/src/tool-approvals.test.ts",
        "cloudflare/control-plane/src/tool-policy.test.ts",
      ],
      guarantees: [
        "execute-contract-validation",
        "durable-approval",
        "policy-recheck",
        "terminal-monotonicity",
      ],
    },
    {
      command: ["test:service-boundaries:agent-system"],
      guarantees: [
        "oauth-connection",
        "durable-proposal",
        "approved-mutation",
        "idempotent-dispatch",
        "action-history",
      ],
    },
  ],
};

const domain = process.argv[2] as Domain | undefined;
if (!domain || !suites[domain])
  throw new Error("Expected data-lifecycle, connections, or actions.");

const results: Array<{
  command: string;
  durationMs: number;
  status: "passed" | "failed";
  guarantees: string[];
}> = [];
let failed = false;
for (const suite of suites[domain]) {
  const started = Date.now();
  const result = spawnSync("pnpm", suite.command, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
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
  domain,
  commit: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  generatedAt: new Date().toISOString(),
  status: failed ? "failed" : "passed",
  guarantees: results.flatMap((result) => result.guarantees),
  results,
  failureArtifacts: [
    "output/playwright",
    "output/playwright/worker.log",
    "output/playwright/runner.log",
  ],
};
const outputDirectory = resolve(process.cwd(), "output/conformance");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, `${domain}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${domain} conformance ${report.status}.`);
if (failed) process.exitCode = 1;
