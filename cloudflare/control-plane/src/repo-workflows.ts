import { selectAgent } from "./authz-store";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { isRecord, json, parseJson } from "./http";
import {
  finishPackWorkflowRun,
  recordPackWorkflowToolCall,
  startPackWorkflowRun,
} from "./pack-workflow-lifecycle";
import { readManagedStateVersion, upsertManagedState } from "./managed-state";
import type { WorkflowInvocationContext } from "./pack-workflow-runtime";
import {
  invokeFlyToolRunner,
  repoSnapshotSandboxContract,
  runnerMetadataFor,
  type ToolAdapterMetadata,
} from "./tool-runner";
import type { AgentIdentity, Env, ExecutionMode } from "./types";
import { authorizeWorkflowTools } from "./workflow-tool-policy";
import {
  repoSnapshotAdapterVersion,
  repoSnapshotError,
  repoSnapshotPolicy,
  repoSnapshotToolName,
  validateRepoSnapshotInput,
  type RepoSnapshotOutput,
  type RepoSnapshotResult,
} from "../../../lib/workbench/repo-snapshot";

export const repoReadinessWorkflowType = "repo.readiness_report";
const repoAnalystPackId = "repo-analyst";
const repoMonitorState = {
  namespace: "repo-monitor",
  stateType: "repository-readiness",
  stateKey: "current",
} as const;

const repoSnapshotAdapter: ToolAdapterMetadata = {
  toolName: repoSnapshotToolName,
  adapterVersion: repoSnapshotAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: "fly",
};

const workflowError = (code: string, message: string, status = 400) =>
  json(
    {
      ok: false,
      error: message,
      details: { code, message, retryable: false, redacted: true },
    },
    { status },
  );

const readInput = (body: unknown) => {
  if (!isRecord(body)) {
    return {
      ok: false as const,
      response: workflowError("invalid_input", "Body must be an object."),
    };
  }
  const mode = typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  if (mode !== "dry_run") {
    return {
      ok: false as const,
      response: workflowError("unsupported_execution_mode", "Only dry_run is supported."),
    };
  }
  const snapshotInput = validateRepoSnapshotInput(isRecord(body.input) ? body.input : body);
  if ("code" in snapshotInput) {
    return {
      ok: false as const,
      response: workflowError(snapshotInput.code, snapshotInput.message),
    };
  }
  return { ok: true as const, mode: "dry_run" as ExecutionMode, snapshotInput };
};

const requireRepoAnalystPack = async (env: Env, identity: AgentIdentity) => {
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  return pack?.id === repoAnalystPackId
    ? { ok: true as const }
    : {
        ok: false as const,
        response: workflowError(
          "pack_required",
          "repo.readiness_report requires the active Repository Analyst pack.",
          403,
        ),
      };
};

export const buildRepoReadinessReport = (output: RepoSnapshotOutput) => {
  const failedCommands = output.commandMetrics.filter((metric) => metric.status !== "completed");
  const verificationScripts = output.scripts.filter((script) =>
    /^(test|typecheck|lint|build|verify|check)(:|$)/.test(script),
  );
  const warnings = [
    output.docs.length === 0 ? "No documentation files were included in the snapshot." : null,
    verificationScripts.length === 0
      ? "No conventional verification scripts were found in the bounded package-script inventory."
      : null,
    ...failedCommands.map((metric) => `${metric.name} finished with status ${metric.status}.`),
  ].filter((item): item is string => Boolean(item));

  return {
    status: warnings.length ? "review" : "ready",
    summary: `Repository snapshot captured ${output.repoFiles.length} files, ${output.docs.length} docs, and ${verificationScripts.length} verification scripts.`,
    packageManager: output.packageManager ?? null,
    inventory: {
      repositoryFiles: output.repoFiles.length,
      documentationFiles: output.docs.length,
      configurationFiles: output.configFiles.length,
    },
    verificationScripts,
    scripts: output.scripts,
    documentation: output.docs,
    configuration: output.configFiles,
    signals: output.signals,
    commandMetrics: output.commandMetrics,
    timingMs: output.timingMs,
    warnings,
    limitations: [
      "The snapshot is bounded to the repository mounted in the configured read-only runner.",
      "Readiness findings describe repository evidence and do not prove deployed service health.",
    ],
    risk: {
      externalMutation: false,
      requiresSecrets: false,
      arbitraryShell: false,
    },
  };
};

export const handleRepoReadinessReport = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  invocation: WorkflowInvocationContext = { source: "user" },
) => {
  const pack = await requireRepoAnalystPack(env, identity);
  if (!pack.ok) return pack.response;
  const parsed = readInput(parseJson(await request.text()));
  if (!parsed.ok) return parsed.response;
  const authorization = await authorizeWorkflowTools(env, identity, {
    toolNames: [repoSnapshotToolName],
    executionMode: parsed.mode,
    requestedRuntimeMs: 10_000,
    requestedArtifactBytes: 128 * 1024,
  });
  if (!authorization.ok) return authorization.response;
  const managedStateVersion = await readManagedStateVersion(env, identity, repoMonitorState);

  const workflow = await startPackWorkflowRun(env, identity, {
    workflowType: repoReadinessWorkflowType,
    policyReference: repoSnapshotPolicy,
    displayName: "Repository readiness report",
    packId: repoAnalystPackId,
    toolInput: parsed.snapshotInput,
    executionMode: parsed.mode,
    engine: "cloudflare",
    invocation,
    intentCreatedSummary: "Created Repository Analyst readiness workflow intent.",
  });
  const runner = runnerMetadataFor(
    repoSnapshotAdapter,
    "agent-pack",
    "fly",
    repoSnapshotSandboxContract(),
  );
  const rawResult = await invokeFlyToolRunner(env, identity, {
    scope: identity.scope,
    agentId: identity.agentId,
    runId: workflow.runId,
    workflowIntentId: workflow.workflowIntentId,
    toolName: repoSnapshotToolName,
    execution: { mode: parsed.mode, policy: repoSnapshotPolicy },
    input: parsed.snapshotInput,
    runner,
    callback: {
      url: `${new URL(request.url).origin}/workbench/run-callbacks`,
      protocolVersion: "workflow-callback-v0",
    },
    source: "agent-pack",
  });
  const result: RepoSnapshotResult =
    rawResult.ok && "repoFiles" in rawResult.output
      ? (rawResult as RepoSnapshotResult)
      : !rawResult.ok
        ? (rawResult as RepoSnapshotResult)
        : {
            ok: false,
            error: repoSnapshotError(
              "repo_snapshot_failed",
              "Runner returned an invalid repository snapshot response.",
              true,
            ),
          };

  const callbackMetrics = isRecord(rawResult.metrics?.callback) ? rawResult.metrics.callback : null;
  if (callbackMetrics?.status === "completed") {
    if (!result.ok) {
      return json({ ok: false, error: result.error.message, run: workflow }, { status: 502 });
    }
    const artifactId = `${workflow.runId}-artifact-repo-snapshot`;
    const report = buildRepoReadinessReport(result.output);
    await upsertManagedState(env, identity, {
      id: `${identity.agentId}-repo-readiness-current`,
      ...repoMonitorState,
      status: report.status,
      summary: report.summary,
      artifactRefs: [artifactId],
      data: { report, runId: workflow.runId, workflowIntentId: workflow.workflowIntentId },
      expectedVersion: managedStateVersion,
    });
    return json({
      ok: true,
      run: {
        id: workflow.runId,
        workflowIntentId: workflow.workflowIntentId,
        status: "completed",
        engine: "cloudflare",
        workflowType: repoReadinessWorkflowType,
      },
      artifact: {
        id: artifactId,
        kind: "repo_snapshot_report",
        uri: `d1://control-plane/${workflow.runId}/repo-snapshot-report.json`,
        title: "Repository snapshot report",
        mimeType: "application/json",
      },
    });
  }

  await recordPackWorkflowToolCall(env, identity, {
    ...workflow,
    toolName: repoSnapshotToolName,
    status: result.ok ? "completed" : "failed",
    inputSummary: "Capture bounded repository snapshot",
    outputSummary: result.ok ? result.output.summary : result.error.message,
    data: result.ok ? { output: result.output, runner } : { error: result.error, runner },
  });

  if (!result.ok) {
    const finished = await finishPackWorkflowRun(env, identity, {
      ...workflow,
      workflowType: repoReadinessWorkflowType,
      ok: false,
      summary: result.error.message,
      data: { packId: repoAnalystPackId, error: result.error },
    });
    if (!finished.applied) {
      return json(
        { ok: false, error: "Run output was discarded after cancellation." },
        { status: 409 },
      );
    }
    await upsertManagedState(env, identity, {
      id: `${identity.agentId}-repo-readiness-current`,
      ...repoMonitorState,
      status: "failed",
      summary: result.error.message,
      data: {
        errorCode: result.error.code,
        runId: workflow.runId,
        workflowIntentId: workflow.workflowIntentId,
      },
      expectedVersion: managedStateVersion,
    });
    return json({ ok: false, error: result.error.message, run: workflow }, { status: 502 });
  }

  const report = buildRepoReadinessReport(result.output);
  const artifactData = {
    source: "repo_readiness_report",
    workflowType: repoReadinessWorkflowType,
    packId: repoAnalystPackId,
    report,
  };
  const artifact = {
    id: `${workflow.runId}-repo-readiness-report`,
    kind: "repo_readiness_report",
    uri: `d1://control-plane/${workflow.runId}/repo-readiness-report.json`,
    title: "Repository readiness report",
    mimeType: "application/json",
    sizeBytes: JSON.stringify(artifactData).length,
    data: artifactData,
  };
  const finished = await finishPackWorkflowRun(env, identity, {
    ...workflow,
    workflowType: repoReadinessWorkflowType,
    ok: true,
    summary: report.summary,
    artifact,
    artifactCreatedSummary: "Created Repository Analyst readiness artifact.",
    data: {
      packId: repoAnalystPackId,
      workflowType: repoReadinessWorkflowType,
      outputSummary: report.summary,
    },
  });
  if (!finished.applied) {
    return json(
      { ok: false, error: "Run output was discarded after cancellation." },
      { status: 409 },
    );
  }

  await upsertManagedState(env, identity, {
    id: `${identity.agentId}-repo-readiness-current`,
    ...repoMonitorState,
    status: report.status,
    summary: report.summary,
    artifactRefs: [artifact.id],
    data: { report, runId: workflow.runId, workflowIntentId: workflow.workflowIntentId },
    expectedVersion: managedStateVersion,
  });

  return json(
    {
      ok: true,
      run: {
        id: workflow.runId,
        workflowIntentId: workflow.workflowIntentId,
        status: "completed",
        engine: "cloudflare",
        workflowType: repoReadinessWorkflowType,
      },
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        uri: artifact.uri,
        title: artifact.title,
        mimeType: artifact.mimeType,
      },
      report,
    },
    { status: 201 },
  );
};
