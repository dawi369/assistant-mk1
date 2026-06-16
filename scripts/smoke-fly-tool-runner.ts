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

const invocationBody = (runId = `cf-run-${suffix}`) =>
  JSON.stringify({
    scope,
    agentId: `agent:${scope.workspaceId}:default`,
    runId,
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
    runner?: { transport?: string; adapterVersion?: string };
  };
  if (
    !validBody.ok ||
    validBody.output?.status !== 200 ||
    validBody.runner?.transport !== "fly" ||
    validBody.runner.adapterVersion !== "url-inspect-v1"
  ) {
    throw new Error(`valid runner response was unexpected: ${JSON.stringify(validBody)}`);
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
