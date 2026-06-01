import type { Id, LifecycleEventName } from "@/lib/agent-framework/contracts";
import { executeRegisteredTool, getVisibleTools } from "@/lib/agent-framework/tool-runtime";
import type {
  ArtifactMetadataRecord,
  AuditEventRecord,
  DecisionRecordEntity,
  RunRecord,
  ToolCallRecord,
  WorkflowIntentRecord,
} from "@/lib/agent-framework/db-contracts";
import { recordCloudflareRunProbe } from "@/lib/workbench/cloudflare-control-plane-client";
import { DEMO_AGENT_ID, DEMO_SCOPE, demoDataClient } from "@/lib/workbench/demo-data-client";
import {
  type DemoInspectInput,
  type DemoInspectOutput,
  DEMO_INSPECT_TOOL_NAME,
  workbenchToolExposureResolver,
  workbenchToolRegistry,
} from "@/lib/workbench/tool-registry";

export type DemoRunSnapshot = {
  scope: typeof DEMO_SCOPE;
  intent: WorkflowIntentRecord | null;
  run: RunRecord | null;
  toolCalls: ToolCallRecord[];
  artifacts: ArtifactMetadataRecord[];
  decisions: DecisionRecordEntity[];
  auditEvents: AuditEventRecord[];
};

const actor = { type: "system", name: "Fixture Runtime" };
const execution = { mode: "dry_run" as const, policy: "fixture-demo" };
const demoInspectInput = { target: "workspace" as const };

const appendAudit = async (
  action: LifecycleEventName,
  summary: string,
  links: { runId?: Id; workflowIntentId?: Id; targetId?: Id; targetType?: string },
  data?: Record<string, unknown>,
) =>
  demoDataClient.audit.append(DEMO_SCOPE, {
    actor,
    action,
    summary,
    target:
      links.targetId && links.targetType
        ? { type: links.targetType, id: links.targetId }
        : undefined,
    data: {
      eventName: action,
      runId: links.runId,
      workflowIntentId: links.workflowIntentId,
      ...data,
    },
  });

const cloudflareProbeAuditData = (
  result: Awaited<ReturnType<typeof recordCloudflareRunProbe>>,
): Record<string, unknown> => {
  if (!result.enabled) {
    return { cloudflareControlPlane: { enabled: false } };
  }

  if (!result.ok) {
    return {
      cloudflareControlPlane: {
        enabled: true,
        ok: false,
        status: result.status,
        error: result.error,
      },
    };
  }

  return {
    cloudflareControlPlane: {
      enabled: true,
      ok: true,
      runId: result.probe.runId,
      status: result.probe.status,
      updatedAt: result.probe.updatedAt,
    },
  };
};

const reportCloudflareRunProbe = async (input: {
  runId: Id;
  workflowIntentId: Id;
  status: RunRecord["status"];
  action: LifecycleEventName;
  summary: string;
}) => {
  const result = await recordCloudflareRunProbe({
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    status: input.status,
    summary: input.summary,
    data: {
      source: "next-workbench-demo-runtime",
      agentId: DEMO_AGENT_ID,
    },
  });

  if (!result.enabled) return;

  await appendAudit(
    input.action,
    result.ok
      ? `${input.summary} Cloudflare control-plane probe recorded.`
      : `${input.summary} Cloudflare control-plane probe failed.`,
    {
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      targetId: input.runId,
      targetType: "run",
    },
    cloudflareProbeAuditData(result),
  );
};

const getIntentForRun = async (run: RunRecord | null) => {
  if (!run?.workflowIntentId) return null;
  const intents = await demoDataClient.listWorkflowIntents(DEMO_SCOPE);
  return intents.find((intent) => intent.id === run.workflowIntentId) ?? null;
};

export const getDemoRunSnapshot = async (runId: Id): Promise<DemoRunSnapshot | null> => {
  const run = (await demoDataClient.getRun(DEMO_SCOPE, runId)) ?? null;
  if (!run) return null;
  const intent = await getIntentForRun(run);
  const toolCalls = await demoDataClient.listToolCalls(DEMO_SCOPE);
  const artifacts = await demoDataClient.listArtifacts(DEMO_SCOPE);
  const decisions = await demoDataClient.decisions.list(DEMO_SCOPE);
  const auditEvents = await demoDataClient.listAuditEvents(DEMO_SCOPE);

  return {
    scope: DEMO_SCOPE,
    intent,
    run,
    toolCalls: toolCalls.filter((record) => record.workflowIntentId === run.workflowIntentId),
    artifacts: artifacts.filter((record) =>
      run.artifactRefs?.some((artifactRef) => artifactRef.id === record.id),
    ),
    decisions: decisions.filter((record) => run.decisionRecordIds?.includes(record.id)),
    auditEvents: auditEvents.filter((record) => record.data?.runId === run.id),
  };
};

export const getLatestDemoRunSnapshot = async () => {
  const latestRunId = await demoDataClient.getLatestRunId(DEMO_SCOPE);
  return latestRunId ? getDemoRunSnapshot(latestRunId) : null;
};

export const startDemoInspectRun = async () => {
  const intent = await demoDataClient.workflowIntents.create(DEMO_SCOPE, {
    agentId: DEMO_AGENT_ID,
    stage: "observe",
    type: "demo.inspect",
    execution,
    payload: {
      target: "workspace",
      requestedBy: "manual-demo",
    },
    status: "queued",
  });

  const queuedAt = new Date().toISOString();
  const run = await demoDataClient.runs.create(DEMO_SCOPE, {
    agentId: DEMO_AGENT_ID,
    workflowIntentId: intent.id,
    status: "queued",
    execution,
    stage: "observe",
    engine: "fixture",
    externalRunId: await demoDataClient.createId("fixture-engine-run"),
    heartbeatAt: queuedAt,
    lastEventAt: queuedAt,
    data: {
      displayName: "Demo inspect",
    },
  });

  await appendAudit("intent.created", "Created demo.inspect workflow intent.", {
    runId: run.id,
    workflowIntentId: intent.id,
    targetId: intent.id,
    targetType: "workflowIntent",
  });
  await appendAudit("run.queued", "Queued local demo run.", {
    runId: run.id,
    workflowIntentId: intent.id,
    targetId: run.id,
    targetType: "run",
  });
  await reportCloudflareRunProbe({
    runId: run.id,
    workflowIntentId: intent.id,
    status: "queued",
    action: "run.queued",
    summary: "Reported queued demo run to local Cloudflare control plane.",
  });

  scheduleDemoRun(run.id, intent.id);
  return getDemoRunSnapshot(run.id);
};

const scheduleDemoRun = (runId: Id, workflowIntentId: Id) => {
  setTimeout(() => {
    void markDemoRunRunning(runId, workflowIntentId);
  }, 300);

  setTimeout(() => {
    void completeDemoRun(runId, workflowIntentId);
  }, 1_400);
};

const markDemoRunRunning = async (runId: Id, workflowIntentId: Id) => {
  const timestamp = new Date().toISOString();
  await demoDataClient.workflowIntents.updateStatus(DEMO_SCOPE, {
    id: workflowIntentId,
    status: "running",
  });
  const run = await demoDataClient.runs.updateStatus(DEMO_SCOPE, {
    id: runId,
    status: "running",
    heartbeatAt: timestamp,
    lastEventAt: timestamp,
  });
  await appendAudit("run.started", "Started local demo run.", {
    runId,
    workflowIntentId,
    targetId: run.id,
    targetType: "run",
  });
  await reportCloudflareRunProbe({
    runId,
    workflowIntentId,
    status: "running",
    action: "run.started",
    summary: "Reported running demo run to local Cloudflare control plane.",
  });

  const visibleTools = await getVisibleTools(
    workbenchToolRegistry,
    {
      scope: DEMO_SCOPE,
      agentId: DEMO_AGENT_ID,
      runId,
      execution,
      stage: "observe",
    },
    workbenchToolExposureResolver,
  );
  const demoInspectTool = visibleTools.find((tool) => tool.name === DEMO_INSPECT_TOOL_NAME);
  if (!demoInspectTool) {
    await demoDataClient.runs.updateStatus(DEMO_SCOPE, {
      id: runId,
      status: "failed",
      data: { failureSummary: "Demo inspect tool was not exposed by policy." },
    });
    await appendAudit("run.failed", "Demo inspect tool was not exposed by policy.", {
      runId,
      workflowIntentId,
      targetId: runId,
      targetType: "run",
    });
    await reportCloudflareRunProbe({
      runId,
      workflowIntentId,
      status: "failed",
      action: "run.failed",
      summary: "Reported failed demo run to local Cloudflare control plane.",
    });
    return;
  }

  const toolCall = await demoDataClient.toolCalls.recordStarted(DEMO_SCOPE, {
    toolId: demoInspectTool.name,
    workflowIntentId,
    agentId: DEMO_AGENT_ID,
    execution,
    status: "running",
    inputSummary: "Inspect fixture workspace in dry-run mode.",
    startedAt: timestamp,
  });

  await demoDataClient.linkRunToolCall(DEMO_SCOPE, { runId: run.id, toolCallId: toolCall.id });
  await appendAudit("tool.started", "Started demo.inspect tool call.", {
    runId,
    workflowIntentId,
    targetId: toolCall.id,
    targetType: "toolCall",
  });
};

const completeDemoRun = async (runId: Id, workflowIntentId: Id) => {
  const run = await demoDataClient.getRun(DEMO_SCOPE, runId);
  if (!run || run.status !== "running") return;

  const toolCalls = await demoDataClient.listToolCalls(DEMO_SCOPE);
  const toolCall = toolCalls.find(
    (record) => record.workflowIntentId === workflowIntentId && record.status === "running",
  );
  const toolResult = await executeRegisteredTool<DemoInspectInput, DemoInspectOutput>(
    workbenchToolRegistry,
    {
      toolName: DEMO_INSPECT_TOOL_NAME,
      input: demoInspectInput,
      context: {
        scope: DEMO_SCOPE,
        execution,
        workflowIntentId,
      },
    },
  );

  if (!toolResult.ok || !toolCall) {
    await demoDataClient.runs.updateStatus(DEMO_SCOPE, {
      id: runId,
      status: "failed",
      data: { failureSummary: "Demo tool failed unexpectedly." },
    });
    await appendAudit("run.failed", "Demo run failed before producing required outputs.", {
      runId,
      workflowIntentId,
      targetId: runId,
      targetType: "run",
    });
    await reportCloudflareRunProbe({
      runId,
      workflowIntentId,
      status: "failed",
      action: "run.failed",
      summary: "Reported failed demo run to local Cloudflare control plane.",
    });
    return;
  }

  const artifact = await demoDataClient.artifacts.createMetadata(DEMO_SCOPE, {
    kind: "report",
    uri: `demo://artifacts/${runId}/inspect-report.json`,
    title: "Demo inspect report",
    mimeType: "application/json",
    sizeBytes: JSON.stringify(toolResult.output).length,
    createdBy: actor,
    data: {
      output: toolResult.output,
    },
  });

  await demoDataClient.toolCalls.recordFinished(DEMO_SCOPE, {
    id: toolCall.id,
    status: "completed",
    finishedAt: new Date().toISOString(),
    outputSummary: toolResult.output.summary,
    artifactRefs: [
      {
        id: artifact.id,
        kind: artifact.kind,
        uri: artifact.uri,
        title: artifact.title,
        mimeType: artifact.mimeType,
      },
    ],
    data: {
      output: toolResult.output,
    },
  });
  await appendAudit("tool.finished", "Finished demo.inspect tool call.", {
    runId,
    workflowIntentId,
    targetId: toolCall.id,
    targetType: "toolCall",
  });

  const decision = await demoDataClient.decisions.create(DEMO_SCOPE, {
    agentId: DEMO_AGENT_ID,
    title: "Demo inspect completed",
    summary: "The fixture workspace dry-run inspection completed and produced durable outputs.",
    thesis: "Assistant-MK1 can represent a workflow run outside hidden transcript state.",
    status: "active",
    provenanceRefs: [
      {
        id: toolCall.id,
        kind: "tool_result",
        title: "demo.inspect result",
        capturedAt: new Date().toISOString(),
      },
    ],
    artifactRefs: [
      {
        id: artifact.id,
        kind: artifact.kind,
        uri: artifact.uri,
        title: artifact.title,
        mimeType: artifact.mimeType,
      },
    ],
  });

  const artifactRef = {
    id: artifact.id,
    kind: artifact.kind,
    uri: artifact.uri,
    title: artifact.title,
    mimeType: artifact.mimeType,
  };
  await demoDataClient.linkRunOutputs(DEMO_SCOPE, {
    runId,
    artifactRef,
    decisionRecordId: decision.id,
  });

  await appendAudit("artifact.created", "Created demo inspect artifact metadata.", {
    runId,
    workflowIntentId,
    targetId: artifact.id,
    targetType: "artifact",
  });
  await appendAudit("decision.created", "Created demo decision record.", {
    runId,
    workflowIntentId,
    targetId: decision.id,
    targetType: "decision",
  });

  const completedAt = new Date().toISOString();
  await demoDataClient.workflowIntents.updateStatus(DEMO_SCOPE, {
    id: workflowIntentId,
    status: "completed",
  });
  await demoDataClient.runs.updateStatus(DEMO_SCOPE, {
    id: runId,
    status: "completed",
    heartbeatAt: completedAt,
    lastEventAt: completedAt,
  });
  await appendAudit("run.completed", "Completed local demo run.", {
    runId,
    workflowIntentId,
    targetId: runId,
    targetType: "run",
  });
  await reportCloudflareRunProbe({
    runId,
    workflowIntentId,
    status: "completed",
    action: "run.completed",
    summary: "Reported completed demo run to local Cloudflare control plane.",
  });
};
