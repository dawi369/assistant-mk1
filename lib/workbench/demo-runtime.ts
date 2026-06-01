import type { Id, LifecycleEventName } from "@/lib/agent-framework/contracts";
import type {
  ArtifactMetadataRecord,
  AuditEventRecord,
  DecisionRecordEntity,
  RunRecord,
  ToolCallRecord,
  WorkflowIntentRecord,
} from "@/lib/agent-framework/db-contracts";
import {
  DEMO_AGENT_ID,
  DEMO_SCOPE,
  createDemoId,
  demoDataClient,
  getDemoStore,
} from "@/lib/workbench/demo-data-client";
import { demoInspectTool } from "@/lib/workbench/demo-tool";

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

const appendAudit = async (
  action: LifecycleEventName,
  summary: string,
  links: { runId?: Id; workflowIntentId?: Id; targetId?: Id; targetType?: string },
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
    },
  });

const getIntentForRun = (run: RunRecord | null) => {
  if (!run?.workflowIntentId) return null;
  return (
    getDemoStore().workflowIntents.find((intent) => intent.id === run.workflowIntentId) ?? null
  );
};

export const getDemoRunSnapshot = (runId: Id): DemoRunSnapshot | null => {
  const store = getDemoStore();
  const run = store.runs.find((record) => record.id === runId) ?? null;
  if (!run) return null;
  const intent = getIntentForRun(run);

  return {
    scope: DEMO_SCOPE,
    intent,
    run,
    toolCalls: store.toolCalls.filter((record) => record.workflowIntentId === run.workflowIntentId),
    artifacts: store.artifacts.filter((record) =>
      run.artifactRefs?.some((artifactRef) => artifactRef.id === record.id),
    ),
    decisions: store.decisions.filter((record) => run.decisionRecordIds?.includes(record.id)),
    auditEvents: store.auditEvents.filter((record) => record.data?.runId === run.id),
  };
};

export const getLatestDemoRunSnapshot = () => {
  const latestRunId = getDemoStore().latestRunId;
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
    externalRunId: createDemoId("fixture-engine-run"),
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

  const toolCall = await demoDataClient.toolCalls.recordStarted(DEMO_SCOPE, {
    toolId: demoInspectTool.name,
    workflowIntentId,
    agentId: DEMO_AGENT_ID,
    execution,
    status: "running",
    inputSummary: "Inspect fixture workspace in dry-run mode.",
    startedAt: timestamp,
  });

  run.toolCallIds = [...(run.toolCallIds ?? []), toolCall.id];
  await appendAudit("tool.started", "Started demo.inspect tool call.", {
    runId,
    workflowIntentId,
    targetId: toolCall.id,
    targetType: "toolCall",
  });
};

const completeDemoRun = async (runId: Id, workflowIntentId: Id) => {
  const store = getDemoStore();
  const run = store.runs.find((record) => record.id === runId);
  if (!run || run.status !== "running") return;

  const toolCall = store.toolCalls.find(
    (record) => record.workflowIntentId === workflowIntentId && record.status === "running",
  );
  const toolResult = await demoInspectTool.execute(
    { target: "workspace" },
    {
      scope: DEMO_SCOPE,
      execution,
      workflowIntentId,
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

  run.artifactRefs = [
    {
      id: artifact.id,
      kind: artifact.kind,
      uri: artifact.uri,
      title: artifact.title,
      mimeType: artifact.mimeType,
    },
  ];
  run.decisionRecordIds = [decision.id];

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
};
