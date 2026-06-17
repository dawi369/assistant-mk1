import { facadeSignatureHeader, signFacadeRequest } from "../lib/workbench/control-plane-signing";
import { runSmoke } from "./smoke-utils";

const baseUrl = (process.env.LANGGRAPH_RUNTIME_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const signingSecret = process.env.WORKBENCH_RUNNER_SIGNING_SECRET?.trim();
if (!signingSecret) {
  throw new Error("WORKBENCH_RUNNER_SIGNING_SECRET is required for Fly runner smoke");
}

const path = "/workbench/tool-runners/invocations";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const scope = {
  userId: `runner-user-${suffix}`,
  workspaceId: `workspace:workos-org:runner-org-${suffix}:default`,
};

const sandbox = (allowedHosts = ["example.com"]) => ({
  lifecycle: {
    template: "url-inspect-v1",
    setup: "per_invocation",
    workspaceState: "none",
    filesystem: "ephemeral",
    artifactPromotion: "metadata_only",
  },
  network: {
    egress: "public_web",
    allowedSchemes: ["http", "https"],
    allowedHosts,
    deniedHosts: [],
    privateNetwork: "deny",
    enforcement: "control_plane_and_runner",
  },
  limits: {},
});

const invocationBody = (
  runId = `cf-run-${suffix}`,
  input: { url: string } = { url: "https://example.com" },
  allowedHosts = ["example.com"],
) =>
  JSON.stringify({
    scope,
    agentId: `agent:${scope.workspaceId}:default`,
    runId,
    workflowIntentId: `cf-intent-${suffix}`,
    toolName: "url.inspect",
    execution: { mode: "dry_run", policy: "tool-admin-readonly-v0" },
    input,
    runner: {
      transport: "fly",
      adapterVersion: "url-inspect-v1",
      source: "admin",
      sandbox: sandbox(allowedHosts),
    },
    policyDecisionId: `cf-policy-${suffix}`,
    source: "admin",
  });

const signedFetch = async (input?: {
  body?: string;
  timestamp?: string;
  nonce?: string;
  tamper?: (headers: Record<string, string>) => void;
}) => {
  const body = input?.body ?? invocationBody();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-assistant-mk1-user-id": scope.userId,
    "x-assistant-mk1-workspace-id": scope.workspaceId,
    "x-assistant-mk1-agent-id": `agent:${scope.workspaceId}:default`,
    "x-assistant-mk1-run-id": `cf-run-${suffix}`,
    "x-assistant-mk1-workflow-intent-id": `cf-intent-${suffix}`,
    "x-assistant-mk1-tool-name": "url.inspect",
  };
  Object.assign(
    headers,
    await signFacadeRequest({
      secret: signingSecret,
      method: "POST",
      pathWithQuery: path,
      body,
      headers,
      timestamp: input?.timestamp,
      nonce: input?.nonce,
    }),
  );
  input?.tamper?.(headers);
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body,
  });
};

const expectRunnerAuthError = async (response: Response, code: string) => {
  if (response.status !== 401) {
    throw new Error(`expected 401 ${code}, got ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { details?: { code?: string } };
  if (body.details?.code !== code) {
    throw new Error(`expected ${code}, got ${JSON.stringify(body)}`);
  }
};

runSmoke("Fly tool runner smoke", async () => {
  console.log(`Smoking Fly tool runner at ${baseUrl}`);

  const valid = await signedFetch({ nonce: `valid-${suffix}` });
  if (!valid.ok) {
    throw new Error(`valid runner request failed with ${valid.status}: ${await valid.text()}`);
  }
  const validBody = (await valid.json()) as {
    ok?: boolean;
    output?: { status?: number; finalUrl?: string };
    runner?: {
      transport?: string;
      adapterVersion?: string;
      sandbox?: { network?: { privateNetwork?: string } };
    };
  };
  if (
    !validBody.ok ||
    validBody.output?.status !== 200 ||
    validBody.runner?.transport !== "fly" ||
    validBody.runner.adapterVersion !== "url-inspect-v1" ||
    validBody.runner.sandbox?.network?.privateNetwork !== "deny"
  ) {
    throw new Error(`valid runner response was unexpected: ${JSON.stringify(validBody)}`);
  }

  const blockedEgress = await signedFetch({
    body: invocationBody(`cf-run-blocked-egress-${suffix}`, { url: "https://example.com" }, [
      "allowed.example",
    ]),
    nonce: `blocked-egress-${suffix}`,
  });
  if (blockedEgress.status !== 403) {
    throw new Error(`expected sandbox egress block, got ${blockedEgress.status}`);
  }
  const blockedEgressBody = (await blockedEgress.json()) as { error?: { code?: string } };
  if (blockedEgressBody.error?.code !== "sandbox_egress_not_allowed") {
    throw new Error(`sandbox egress block missing code: ${JSON.stringify(blockedEgressBody)}`);
  }

  const missingSandboxBody = JSON.stringify({
    scope,
    agentId: `agent:${scope.workspaceId}:default`,
    runId: `cf-run-missing-sandbox-${suffix}`,
    workflowIntentId: `cf-intent-${suffix}`,
    toolName: "url.inspect",
    execution: { mode: "dry_run", policy: "tool-admin-readonly-v0" },
    input: { url: "https://example.com" },
    runner: {
      transport: "fly",
      adapterVersion: "url-inspect-v1",
      source: "admin",
    },
    policyDecisionId: `cf-policy-${suffix}`,
    source: "admin",
  });
  const missingSandbox = await signedFetch({
    body: missingSandboxBody,
    nonce: `missing-sandbox-${suffix}`,
  });
  if (missingSandbox.status !== 403) {
    throw new Error(`expected missing sandbox block, got ${missingSandbox.status}`);
  }
  const missingSandboxResponse = (await missingSandbox.json()) as { error?: { code?: string } };
  if (missingSandboxResponse.error?.code !== "sandbox_required") {
    throw new Error(
      `missing sandbox block missing code: ${JSON.stringify(missingSandboxResponse)}`,
    );
  }

  const unsigned = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-assistant-mk1-user-id": scope.userId,
    },
    body: invocationBody(`cf-run-unsigned-${suffix}`),
  });
  await expectRunnerAuthError(unsigned, "signature_required");

  const stale = await signedFetch({
    timestamp: String(Date.now() - 10 * 60 * 1000),
    nonce: `stale-${suffix}`,
  });
  await expectRunnerAuthError(stale, "signature_stale");

  const replayBody = invocationBody(`cf-run-replay-${suffix}`);
  const replayTimestamp = String(Date.now());
  const replayNonce = `replay-${suffix}`;
  const replayHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-assistant-mk1-user-id": scope.userId,
    "x-assistant-mk1-workspace-id": scope.workspaceId,
    "x-assistant-mk1-agent-id": `agent:${scope.workspaceId}:default`,
    "x-assistant-mk1-run-id": `cf-run-replay-${suffix}`,
    "x-assistant-mk1-workflow-intent-id": `cf-intent-${suffix}`,
    "x-assistant-mk1-tool-name": "url.inspect",
  };
  Object.assign(
    replayHeaders,
    await signFacadeRequest({
      secret: signingSecret,
      method: "POST",
      pathWithQuery: path,
      body: replayBody,
      headers: replayHeaders,
      timestamp: replayTimestamp,
      nonce: replayNonce,
    }),
  );
  const firstReplay = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: replayHeaders,
    body: replayBody,
  });
  if (!firstReplay.ok) {
    throw new Error(`first replay request should succeed: ${firstReplay.status}`);
  }
  const secondReplay = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: replayHeaders,
    body: replayBody,
  });
  await expectRunnerAuthError(secondReplay, "signature_replay");

  const tamperedBody = await signedFetch({
    body: invocationBody(`cf-run-body-${suffix}`),
    nonce: `body-${suffix}`,
  });
  if (!tamperedBody.ok) {
    throw new Error(`body baseline should succeed: ${tamperedBody.status}`);
  }
  const signedBody = invocationBody(`cf-run-body-mismatch-${suffix}`);
  const tamperHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-assistant-mk1-user-id": scope.userId,
    "x-assistant-mk1-workspace-id": scope.workspaceId,
    "x-assistant-mk1-agent-id": `agent:${scope.workspaceId}:default`,
    "x-assistant-mk1-run-id": `cf-run-body-mismatch-${suffix}`,
    "x-assistant-mk1-workflow-intent-id": `cf-intent-${suffix}`,
    "x-assistant-mk1-tool-name": "url.inspect",
  };
  Object.assign(
    tamperHeaders,
    await signFacadeRequest({
      secret: signingSecret,
      method: "POST",
      pathWithQuery: path,
      body: signedBody,
      headers: tamperHeaders,
      nonce: `body-mismatch-${suffix}`,
    }),
  );
  const bodyMismatch = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: tamperHeaders,
    body: invocationBody(`cf-run-body-mismatch-tampered-${suffix}`),
  });
  await expectRunnerAuthError(bodyMismatch, "body_hash_mismatch");

  const invalid = await signedFetch({
    nonce: `invalid-${suffix}`,
    tamper: (headers) => {
      headers["x-assistant-mk1-user-id"] = `tampered-${scope.userId}`;
    },
  });
  await expectRunnerAuthError(invalid, "signature_invalid");

  const missing = await signedFetch({
    nonce: `missing-${suffix}`,
    tamper: (headers) => {
      delete headers[facadeSignatureHeader];
    },
  });
  await expectRunnerAuthError(missing, "signature_required");

  console.log(
    JSON.stringify(
      {
        runId: `cf-run-${suffix}`,
        replayTimestamp,
      },
      null,
      2,
    ),
  );
});

export {};
