import { type TenantIdentity, createSmokeContext, runSmoke, sleep } from "./smoke-utils";

type BoundarySnapshot = {
  ok?: boolean;
  latestIntent?: {
    id?: string;
    executionMode?: string;
    status?: string;
  } | null;
  latestPolicyDecision?: {
    id?: string;
    intentId?: string;
    decision?: string;
    reason?: string;
    executionMode?: string;
  } | null;
  latestRun?: {
    id?: string;
    intentId?: string;
    policyDecisionId?: string;
    upstreamRunId?: string;
    status?: string;
  } | null;
  error?: string;
};

const {
  baseUrl,
  pollTimeoutMs,
  pollIntervalMs,
  readJson,
  streamBody,
  startStream,
  startAcceptedStreamOnNewThread,
} = createSmokeContext();

const tenant: TenantIdentity = {
  userId: "policy-tenant-user",
  workspaceId: "policy-tenant-workspace",
  agentId: "policy-tenant-agent",
};

const getBoundarySnapshot = (identity: TenantIdentity, threadId: string) =>
  readJson<BoundarySnapshot>(
    `/internal/chat-boundary/threads/${encodeURIComponent(threadId)}/snapshot`,
    identity,
  );

const waitForCompletedRun = async (identity: TenantIdentity, threadId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const snapshot = await getBoundarySnapshot(identity, threadId);
    if (snapshot.latestRun?.status === "completed") return snapshot;
    if (snapshot.latestRun?.status === "failed") {
      throw new Error(`tracked chat run failed: ${snapshot.latestRun.id ?? "unknown"}`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`chat run tracking did not complete within ${pollTimeoutMs}ms`);
};

const assertAllowedPolicy = (snapshot: BoundarySnapshot) => {
  if (
    snapshot.latestIntent?.status !== "allowed" ||
    snapshot.latestIntent.executionMode !== "ask" ||
    snapshot.latestPolicyDecision?.decision !== "allow" ||
    snapshot.latestPolicyDecision.executionMode !== "ask" ||
    snapshot.latestRun?.intentId !== snapshot.latestIntent.id ||
    snapshot.latestRun?.policyDecisionId !== snapshot.latestPolicyDecision.id
  ) {
    throw new Error("allowed chat run did not store matching intent, policy, and run records");
  }
};

const assertBlockedPolicy = (
  snapshot: BoundarySnapshot,
  input: { decisionStatus: string; executionMode?: string },
) => {
  if (
    snapshot.latestIntent?.status !== input.decisionStatus ||
    snapshot.latestPolicyDecision?.decision !== "block" ||
    (input.executionMode && snapshot.latestPolicyDecision.executionMode !== input.executionMode)
  ) {
    throw new Error("blocked chat run did not store matching intent and policy records");
  }
};

const assertResponseStatus = async (response: Response, status: number, label: string) => {
  if (response.status !== status) {
    throw new Error(
      `${label} expected ${status}, got ${response.status}: ${await response.text()}`,
    );
  }
  await response.text();
};

runSmoke("Cloudflare policy boundary smoke", async () => {
  console.log(`Smoking Cloudflare policy boundary at ${baseUrl}`);

  const allowed = await startAcceptedStreamOnNewThread(
    tenant,
    streamBody({
      content: "Say one short sentence confirming the policy boundary is live.",
    }),
    "allowed stream",
  );
  await allowed.response.text();
  const completed = await waitForCompletedRun(tenant, allowed.threadId);
  if (!completed.latestRun?.id) throw new Error("allowed policy run is missing run id");
  assertAllowedPolicy(completed);

  const executeBlock = await startStream(
    tenant,
    allowed.threadId,
    streamBody({
      content: "Attempt execute mode.",
      executionMode: "execute",
    }),
  );
  await assertResponseStatus(executeBlock, 403, "execute-mode policy block");
  const executeBlockedSnapshot = await getBoundarySnapshot(tenant, allowed.threadId);
  assertBlockedPolicy(executeBlockedSnapshot, {
    decisionStatus: "blocked",
    executionMode: "execute",
  });

  const firstConcurrent = await startAcceptedStreamOnNewThread(
    tenant,
    streamBody({
      content: "Reply with three short sentences to keep this run briefly open.",
    }),
    "first concurrent stream",
  );

  const duplicateConcurrent = await startStream(
    tenant,
    firstConcurrent.threadId,
    streamBody({
      content: "Attempt a second run on the same thread.",
    }),
  );
  await assertResponseStatus(duplicateConcurrent, 409, "same-thread running policy block");
  const duplicateBlockedSnapshot = await getBoundarySnapshot(tenant, firstConcurrent.threadId);
  assertBlockedPolicy(duplicateBlockedSnapshot, {
    decisionStatus: "blocked",
    executionMode: "ask",
  });

  await firstConcurrent.response.text();
  await waitForCompletedRun(tenant, firstConcurrent.threadId);

  console.log(
    JSON.stringify(
      {
        allowedThreadId: allowed.threadId,
        allowedRunId: completed.latestRun.id,
        allowedIntentId: completed.latestIntent?.id,
        executeBlockPolicyId: executeBlockedSnapshot.latestPolicyDecision?.id,
        concurrentThreadId: firstConcurrent.threadId,
        duplicateBlockPolicyId: duplicateBlockedSnapshot.latestPolicyDecision?.id,
      },
      null,
      2,
    ),
  );
});

export {};
