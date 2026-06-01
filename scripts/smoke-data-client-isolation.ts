import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TenantScope } from "../lib/agent-framework/contracts";
import type { RecordStatus } from "../lib/agent-framework/db-contracts";
import { createFileWorkbenchDataClient } from "../lib/workbench/demo-data-client";

type RecordWithId = {
  id: string;
};

const execution = { mode: "dry_run" as const, policy: "isolation-smoke" };

const createScope = (name: string): TenantScope => ({
  userId: `fixture-user-${name}`,
  workspaceId: `fixture-workspace-${name}`,
});

const requireOnlyOwnRecords = (
  label: string,
  records: RecordWithId[],
  ownId: string,
  otherId: string,
) => {
  if (!records.some((record) => record.id === ownId)) {
    throw new Error(`${label} did not include own record ${ownId}`);
  }
  if (records.some((record) => record.id === otherId)) {
    throw new Error(`${label} leaked cross-tenant record ${otherId}`);
  }
};

const writeRecordSet = async (
  client: ReturnType<typeof createFileWorkbenchDataClient>,
  scope: TenantScope,
  label: string,
) => {
  const agentId = `fixture-agent-${label}`;
  const createdAt = new Date().toISOString();

  await client.workspaceContext.load(scope);

  const intent = await client.workflowIntents.create(scope, {
    agentId,
    stage: "observe",
    type: "demo.inspect",
    execution,
    payload: { tenant: label },
    status: "queued",
  });

  const run = await client.runs.create(scope, {
    agentId,
    workflowIntentId: intent.id,
    status: "queued",
    execution,
    stage: "observe",
    engine: "fixture",
    externalRunId: await client.createId(`engine-${label}`),
    heartbeatAt: createdAt,
    lastEventAt: createdAt,
  });

  const toolCall = await client.toolCalls.recordStarted(scope, {
    toolId: "demo.inspect",
    workflowIntentId: intent.id,
    agentId,
    execution,
    status: "running",
    inputSummary: `Inspect ${label}`,
    startedAt: createdAt,
  });
  await client.linkRunToolCall(scope, { runId: run.id, toolCallId: toolCall.id });

  const artifact = await client.artifacts.createMetadata(scope, {
    kind: "report",
    uri: `demo://artifacts/${run.id}/inspect-report.json`,
    title: `Inspect report ${label}`,
    mimeType: "application/json",
    sizeBytes: 2,
    createdBy: { type: "system", name: "Isolation Smoke" },
  });

  await client.toolCalls.recordFinished(scope, {
    id: toolCall.id,
    status: "completed" satisfies RecordStatus,
    finishedAt: new Date().toISOString(),
    outputSummary: `Completed ${label}`,
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

  const decision = await client.decisions.create(scope, {
    agentId,
    title: `Decision ${label}`,
    summary: `Tenant ${label} completed.`,
    thesis: `Tenant ${label} state is isolated.`,
    status: "active",
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
  await client.linkRunOutputs(scope, {
    runId: run.id,
    artifactRef: {
      id: artifact.id,
      kind: artifact.kind,
      uri: artifact.uri,
      title: artifact.title,
      mimeType: artifact.mimeType,
    },
    decisionRecordId: decision.id,
  });

  const auditEvent = await client.audit.append(scope, {
    actor: { type: "system", name: "Isolation Smoke" },
    action: "run.completed",
    target: { type: "run", id: run.id },
    summary: `Completed ${label}`,
    data: { runId: run.id, workflowIntentId: intent.id },
  });

  const managedState = await client.createManagedState(scope, {
    agentId,
    type: "smoke",
    name: `state-${label}`,
    status: "active",
    summary: `State ${label}`,
  });
  await client.managedState.patch(scope, {
    id: managedState.id,
    summary: `Updated state ${label}`,
  });

  const ledgerEntry = await client.ledger.append(scope, {
    agentId,
    workflowIntentId: intent.id,
    toolCallId: toolCall.id,
    type: "smoke",
    status: "completed",
    summary: `Ledger ${label}`,
    decisionRecordIds: [decision.id],
  });

  await client.workflowIntents.updateStatus(scope, { id: intent.id, status: "completed" });
  await client.runs.updateStatus(scope, {
    id: run.id,
    status: "completed",
    heartbeatAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
  });

  return {
    intent,
    run,
    toolCall,
    artifact,
    decision,
    auditEvent,
    managedState,
    ledgerEntry,
  };
};

const main = async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "assistant-mk1-data-client-"));
  const storePath = path.join(tempDir, "local-store.json");
  const client = createFileWorkbenchDataClient(storePath);

  try {
    const scopeA = createScope("a");
    const scopeB = createScope("b");
    const tenantA = await writeRecordSet(client, scopeA, "a");
    const tenantB = await writeRecordSet(client, scopeB, "b");

    requireOnlyOwnRecords(
      "workflow intents",
      await client.listWorkflowIntents(scopeA),
      tenantA.intent.id,
      tenantB.intent.id,
    );
    requireOnlyOwnRecords("runs", await client.runs.list(scopeA), tenantA.run.id, tenantB.run.id);
    requireOnlyOwnRecords(
      "tool calls",
      await client.listToolCalls(scopeA),
      tenantA.toolCall.id,
      tenantB.toolCall.id,
    );
    requireOnlyOwnRecords(
      "artifacts",
      await client.listArtifacts(scopeA),
      tenantA.artifact.id,
      tenantB.artifact.id,
    );
    requireOnlyOwnRecords(
      "decisions",
      await client.decisions.list(scopeA),
      tenantA.decision.id,
      tenantB.decision.id,
    );
    requireOnlyOwnRecords(
      "audit events",
      await client.listAuditEvents(scopeA),
      tenantA.auditEvent.id,
      tenantB.auditEvent.id,
    );
    requireOnlyOwnRecords(
      "managed state",
      await client.listManagedState(scopeA),
      tenantA.managedState.id,
      tenantB.managedState.id,
    );
    requireOnlyOwnRecords(
      "ledger",
      await client.ledger.list(scopeA),
      tenantA.ledgerEntry.id,
      tenantB.ledgerEntry.id,
    );

    const latestA = await client.getLatestRunId(scopeA);
    const latestB = await client.getLatestRunId(scopeB);
    if (latestA !== tenantA.run.id) throw new Error("Tenant A latest run id was not scoped");
    if (latestB !== tenantB.run.id) throw new Error("Tenant B latest run id was not scoped");

    const reloaded = createFileWorkbenchDataClient(storePath);
    const reloadedLatestA = await reloaded.getLatestRunId(scopeA);
    if (reloadedLatestA !== tenantA.run.id) {
      throw new Error("Reloaded file-backed client did not preserve tenant A latest run");
    }

    console.log("Data-client isolation smoke passed");
    console.log(
      JSON.stringify(
        {
          storePath,
          tenants: 2,
          recordFamilies: [
            "workflowIntents",
            "runs",
            "toolCalls",
            "artifacts",
            "decisions",
            "auditEvents",
            "managedState",
            "ledger",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
