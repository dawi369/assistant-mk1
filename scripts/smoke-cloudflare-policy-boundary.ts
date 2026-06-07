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
  createThread,
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

const readErrorCode = async (response: Response) => {
  const bodyText = await response.text();
  const body = JSON.parse(bodyText) as { errorCode?: string };
  return { bodyText, errorCode: body.errorCode };
};

const assertErrorResponse = async (
  response: Response,
  input: { status: number; errorCode: string; label: string },
) => {
  const bodyText = await response.text();
  if (response.status !== input.status) {
    throw new Error(`${input.label} expected ${input.status}, got ${response.status}: ${bodyText}`);
  }
  const body = JSON.parse(bodyText) as { errorCode?: string };
  if (body.errorCode !== input.errorCode) {
    throw new Error(
      `${input.label} expected errorCode ${input.errorCode}, got ${body.errorCode ?? "none"}`,
    );
  }
};

runSmoke("Cloudflare policy boundary smoke", async () => {
  console.log(`Smoking Cloudflare policy boundary at ${baseUrl}`);

  const allowedThreadId = await createThread(tenant);
  const allowedResponse = await startStream(
    tenant,
    allowedThreadId,
    streamBody({
      content: "Say one short sentence confirming the policy boundary is live.",
    }),
  );
  const missingModelSecret = !allowedResponse.ok;
  const completed = allowedResponse.ok
    ? await (async () => {
        await allowedResponse.text();
        return waitForCompletedRun(tenant, allowedThreadId);
      })()
    : await (async () => {
        const { bodyText, errorCode } = await readErrorCode(allowedResponse);
        if (allowedResponse.status !== 500 || errorCode !== "missing_model_secret") {
          throw new Error(`allowed stream failed with ${allowedResponse.status}: ${bodyText}`);
        }
        return getBoundarySnapshot(tenant, allowedThreadId);
      })();
  if (!completed.latestRun?.id) throw new Error("allowed policy run is missing run id");
  assertAllowedPolicy(completed);

  const executeBlock = await startStream(
    tenant,
    allowedThreadId,
    streamBody({
      content: "Attempt execute mode.",
      executionMode: "execute",
    }),
  );
  await assertResponseStatus(executeBlock, 403, "execute-mode policy block");
  const executeBlockedSnapshot = await getBoundarySnapshot(tenant, allowedThreadId);
  assertBlockedPolicy(executeBlockedSnapshot, {
    decisionStatus: "blocked",
    executionMode: "execute",
  });

  let concurrentThreadId: string | null = null;
  let duplicateBlockPolicyId: string | undefined;

  if (!missingModelSecret) {
    const firstConcurrent = await startAcceptedStreamOnNewThread(
      tenant,
      streamBody({
        content: "Reply with three short sentences to keep this run briefly open.",
      }),
      "first concurrent stream",
    );
    concurrentThreadId = firstConcurrent.threadId;

    const duplicateConcurrent = await startStream(
      tenant,
      firstConcurrent.threadId,
      streamBody({
        content: "Attempt a second run on the same thread.",
      }),
    );
    await assertErrorResponse(duplicateConcurrent, {
      status: 409,
      errorCode: "already_running",
      label: "same-thread running policy block",
    });
    const duplicateBlockedSnapshot = await getBoundarySnapshot(tenant, firstConcurrent.threadId);
    assertBlockedPolicy(duplicateBlockedSnapshot, {
      decisionStatus: "blocked",
      executionMode: "ask",
    });
    duplicateBlockPolicyId = duplicateBlockedSnapshot.latestPolicyDecision?.id;

    await firstConcurrent.response.text();
    await waitForCompletedRun(tenant, firstConcurrent.threadId);
  }

  console.log(
    JSON.stringify(
      {
        allowedThreadId,
        allowedRunId: completed.latestRun.id,
        allowedIntentId: completed.latestIntent?.id,
        missingModelSecret,
        executeBlockPolicyId: executeBlockedSnapshot.latestPolicyDecision?.id,
        concurrentThreadId,
        duplicateBlockPolicyId,
      },
      null,
      2,
    ),
  );
});

export {};
