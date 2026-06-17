import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
  sleep,
} from "./smoke-utils";

type RuntimeTrace = {
  traceId?: string;
  kind?: string;
  status?: string;
  bottleneckSpanId?: string;
  bottleneckConfidence?: string;
  durationMs?: number;
};

type RuntimeSpan = {
  spanId?: string;
  name?: string;
  layer?: string;
  status?: string;
  spanType?: string;
  isAggregate?: boolean;
  bottleneckCandidate?: boolean;
  offsetMs?: number;
  durationMs?: number;
  data?: Record<string, unknown>;
};

type RuntimeTracesResponse = {
  ok?: boolean;
  latestTrace?: RuntimeTrace | null;
  recentTraces?: RuntimeTrace[];
  traceWaterfall?: RuntimeSpan[];
};

type RuntimeTraceResponse = {
  ok?: boolean;
  trace?: RuntimeTrace | null;
  spans?: RuntimeSpan[];
};

type ToolRunResponse = {
  ok?: boolean;
  run?: { id?: string; status?: string };
  toolCall?: { id?: string; status?: string } | null;
  artifact?: { id?: string } | null;
};

type ThreadResponse = {
  thread_id?: string;
};

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    latestTrace?: RuntimeTrace | null;
    recentTraces?: RuntimeTrace[];
    traceWaterfall?: RuntimeSpan[];
  };
};

const {
  baseUrl,
  suffix,
  pollTimeoutMs,
  pollIntervalMs,
  readJson,
  fetchRaw,
  createThread,
  streamBody,
  startStream,
  assertStatus,
} = createSmokeContext();

const accountId = `workos-org:runtime-traces-org-${suffix}`;
const workspaceId = defaultWorkspaceId(accountId);

const owner: TenantIdentity = {
  userId: `runtime-traces-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId,
  email: `runtime-traces-owner-${suffix}@example.com`,
  name: "Runtime Trace Owner",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:tools"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const otherTenant: TenantIdentity = {
  ...owner,
  userId: `runtime-traces-other-${suffix}`,
  accountId: `workos-org:runtime-traces-other-org-${suffix}`,
  workspaceId: defaultWorkspaceId(`workos-org:runtime-traces-other-org-${suffix}`),
  email: `runtime-traces-other-${suffix}@example.com`,
};

const getLatestTraces = (identity: TenantIdentity) =>
  readJson<RuntimeTracesResponse>("/runtime/traces/latest?limit=10", identity);

const getTrace = (identity: TenantIdentity, traceId: string) =>
  readJson<RuntimeTraceResponse>(`/runtime/traces/${encodeURIComponent(traceId)}`, identity);

const requireRecentTrace = async (kind: string) => {
  const traces = await getLatestTraces(owner);
  const trace = traces.recentTraces?.find((item) => item.kind === kind);
  if (!trace?.traceId) {
    throw new Error(`${kind} trace missing from recent traces: ${JSON.stringify(traces)}`);
  }
  return { ...trace, traceId: trace.traceId };
};

const waitForRecentTrace = async (kind: string, status?: string) => {
  const deadline = Date.now() + pollTimeoutMs;
  let lastTrace: RuntimeTrace | undefined;

  while (Date.now() < deadline) {
    const traces = await getLatestTraces(owner);
    lastTrace = traces.recentTraces?.find((item) => item.kind === kind);
    if (lastTrace?.traceId && (!status || lastTrace.status === status)) {
      return { ...lastTrace, traceId: lastTrace.traceId };
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `${kind} trace did not reach ${status ?? "available"}; latest was ${JSON.stringify(lastTrace)}`,
  );
};

const requireSpan = (
  spans: RuntimeSpan[] | undefined,
  predicate: (span: RuntimeSpan) => boolean,
) => {
  const span = spans?.find(predicate);
  if (!span) throw new Error(`expected span missing from ${JSON.stringify(spans)}`);
  return span;
};

runSmoke("Cloudflare runtime traces smoke", async () => {
  console.log(`Smoking Cloudflare runtime traces at ${baseUrl}`);

  const threadId = await createThread(owner);
  const createTrace = await requireRecentTrace("chat.thread.create");
  const createDetail = await getTrace(owner, createTrace.traceId);
  requireSpan(createDetail.spans, (span) => span.name === "Cloudflare authz");
  requireSpan(createDetail.spans, (span) => span.name === "Header/account parse");
  requireSpan(createDetail.spans, (span) => span.name === "Thread ownership write");

  const syntheticTraceId = `trace-smoke-vercel-${suffix}`;
  await readJson<ThreadResponse>("/langgraph/threads", owner, {
    method: "POST",
    headers: {
      "x-assistant-mk1-trace-id": syntheticTraceId,
      "x-assistant-mk1-vercel-started-at": String(Date.now()),
      "x-assistant-mk1-vercel-duration-ms": "0",
    },
    body: "{}",
  });
  const syntheticTrace = await getTrace(owner, syntheticTraceId);
  requireSpan(
    syntheticTrace.spans,
    (span) => span.name === "Vercel handoff" && span.durationMs === 0,
  );

  const stream = await startStream(
    owner,
    threadId,
    streamBody({ content: "Reply with one short sentence about tracing." }),
  );
  if (!stream.ok) {
    throw new Error(`chat stream failed with ${stream.status}: ${await stream.text()}`);
  }
  await stream.text();

  const chatTrace = await waitForRecentTrace("chat.run.stream", "completed");
  const chatDetail = await getTrace(owner, chatTrace.traceId);
  requireSpan(chatDetail.spans, (span) => span.layer === "cloudflare");
  requireSpan(chatDetail.spans, (span) => span.layer === "d1");
  requireSpan(chatDetail.spans, (span) => span.layer === "provider");
  requireSpan(chatDetail.spans, (span) => span.name === "Header/account parse");
  requireSpan(chatDetail.spans, (span) => span.name === "Membership resolve");
  requireSpan(chatDetail.spans, (span) => span.name === "Active/default agent resolve");
  requireSpan(
    chatDetail.spans,
    (span) =>
      span.name === "Pre-stream total" &&
      span.spanType === "phase" &&
      span.isAggregate === true &&
      span.bottleneckCandidate === false,
  );
  requireSpan(chatDetail.spans, (span) => span.name === "OpenRouter first token");
  requireSpan(chatDetail.spans, (span) => span.name === "Stream duration");
  if (!chatDetail.trace?.bottleneckSpanId) {
    throw new Error("chat trace did not compute bottleneck");
  }
  const bottleneck = requireSpan(
    chatDetail.spans,
    (span) => span.spanId === chatDetail.trace?.bottleneckSpanId,
  );
  if (bottleneck.name === "Pre-stream total") {
    throw new Error("aggregate Pre-stream total was selected as bottleneck");
  }
  if (chatDetail.trace.bottleneckConfidence !== "exact") {
    throw new Error(
      `chat trace expected exact bottleneck, got ${chatDetail.trace.bottleneckConfidence}`,
    );
  }
  for (const span of chatDetail.spans ?? []) {
    if (typeof span.offsetMs !== "number" || span.offsetMs < 0) {
      throw new Error(`span offset missing or invalid: ${JSON.stringify(span)}`);
    }
  }

  const toolRun = await readJson<ToolRunResponse>("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  if (!toolRun.ok || toolRun.run?.status !== "completed") {
    throw new Error(`url.inspect did not complete: ${JSON.stringify(toolRun)}`);
  }
  const toolTrace = await requireRecentTrace("tool.url.inspect");
  const toolDetail = await getTrace(owner, toolTrace.traceId);
  requireSpan(toolDetail.spans, (span) => span.name === "HTTP fetch" && span.layer === "tool");
  const runnerDispatchSpan = requireSpan(
    toolDetail.spans,
    (span) => span.name === "Runner dispatch" && span.layer === "executor",
  );
  const runnerData = runnerDispatchSpan.data?.runner;
  if (
    !runnerData ||
    typeof runnerData !== "object" ||
    Array.isArray(runnerData) ||
    typeof (runnerData as { transport?: unknown }).transport !== "string" ||
    typeof (runnerData as { adapterVersion?: unknown }).adapterVersion !== "string" ||
    typeof (runnerData as { source?: unknown }).source !== "string" ||
    typeof (runnerData as { durationMs?: unknown }).durationMs !== "number" ||
    (runnerData as { status?: unknown }).status !== "completed"
  ) {
    throw new Error(`runner dispatch metadata missing: ${JSON.stringify(runnerDispatchSpan)}`);
  }
  const sandboxData = (runnerData as { sandbox?: unknown }).sandbox;
  if (
    !sandboxData ||
    typeof sandboxData !== "object" ||
    Array.isArray(sandboxData) ||
    (sandboxData as { network?: { privateNetwork?: unknown } }).network?.privateNetwork !== "deny"
  ) {
    throw new Error(`runner sandbox metadata missing: ${JSON.stringify(runnerDispatchSpan)}`);
  }
  requireSpan(toolDetail.spans, (span) => span.name === "Artifact/write completion");

  const blocked = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "http://127.0.0.1:8787/health" },
    }),
  });
  if (blocked.status !== 403) {
    throw new Error(`blocked URL expected 403, got ${blocked.status}: ${await blocked.text()}`);
  }
  const blockedTrace = await requireRecentTrace("tool.url.inspect");
  if (blockedTrace.status !== "blocked") {
    throw new Error(`blocked tool trace expected blocked, got ${blockedTrace.status}`);
  }

  await assertStatus(`/runtime/traces/${encodeURIComponent(chatTrace.traceId)}`, otherTenant, 404);

  const adminSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (!adminSummary.summary?.latestTrace?.traceId) {
    throw new Error("admin summary did not include latestTrace");
  }
  if (!adminSummary.summary.recentTraces?.length) {
    throw new Error("admin summary did not include recentTraces");
  }
  if (!adminSummary.summary.traceWaterfall?.length) {
    throw new Error("admin summary did not include traceWaterfall");
  }

  console.log(
    JSON.stringify(
      {
        createTraceId: createTrace.traceId,
        chatTraceId: chatTrace.traceId,
        toolTraceId: toolTrace.traceId,
      },
      null,
      2,
    ),
  );
});

export {};
