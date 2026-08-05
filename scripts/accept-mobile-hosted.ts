import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.WORKBENCH_MOBILE_ACCEPTANCE_MODE !== "true") {
  throw new Error("Set WORKBENCH_MOBILE_ACCEPTANCE_MODE=true for guarded hosted acceptance.");
}
const evidenceInput = process.env.WORKBENCH_MOBILE_DEVICE_EVIDENCE?.trim();
if (!evidenceInput || !existsSync(evidenceInput)) {
  throw new Error(
    "WORKBENCH_MOBILE_DEVICE_EVIDENCE must reference the completed iOS/Android acceptance JSON.",
  );
}
const evidence = JSON.parse(readFileSync(evidenceInput, "utf8")) as Record<string, unknown>;
for (const field of [
  "commit",
  "operator",
  "workosApplicationId",
  "iosDevice",
  "androidDevice",
  "signIn",
  "chatResume",
  "approvalPush",
  "terminalPush",
  "signOutRevocation",
]) {
  if (!evidence[field]) throw new Error(`Hosted mobile evidence is missing ${field}.`);
}
const commit = process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "development";
if (evidence.commit !== commit) throw new Error("Hosted mobile evidence must match this commit.");
const origins = [
  process.env.HOSTED_VERCEL_ORIGIN,
  process.env.HOSTED_CLOUDFLARE_ORIGIN,
  process.env.HOSTED_FLY_ORIGIN,
];
const health = await Promise.all(
  origins.map(async (origin) => {
    if (!origin) throw new Error("All hosted service origins are required.");
    const response = await fetch(
      `${origin}${origin.includes("vercel") ? "/api/health" : "/health"}`,
    );
    if (!response.ok) throw new Error(`Hosted health failed for ${new URL(origin).hostname}.`);
    return response.json() as Promise<Record<string, unknown>>;
  }),
);
if (health.some((item) => item.release !== commit))
  throw new Error("Hosted services do not report the accepted commit.");
const output = resolve(process.cwd(), "output/mobile/hosted-acceptance.json");
mkdirSync(resolve(process.cwd(), "output/mobile"), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      commit,
      status: "passed",
      evidenceSha256: createHash("sha256").update(readFileSync(evidenceInput)).digest("hex"),
      health,
      completedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
console.log(`Hosted mobile acceptance passed: ${output}`);
