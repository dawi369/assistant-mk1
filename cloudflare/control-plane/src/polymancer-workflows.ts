import { selectAgent } from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { isRecord, json, parseJson } from "./http";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { buildControlRunRelation, toControlRunRelationEventData } from "./run-relations";
import { createId, toJson, type AgentIdentity, type Env, type ExecutionMode } from "./types";
import {
  polymarketMarketSearchToolName,
  polymarketMarketSnapshotToolName,
  polymarketOrderbookSnapshotToolName,
  runPolymarketMarketSearch,
  runPolymarketMarketSnapshot,
  runPolymarketOrderbookSnapshot,
  validatePolymarketMarketSearchInput,
  validatePolymarketMarketSnapshotInput,
  type PolymarketMarketSearchInput,
  type PolymarketMarketSnapshotInput,
  type PolymarketOrderbookSnapshotInput,
} from "../../../lib/workbench/polymarket-readonly";

const workflowType = "polymancer.market_research";
const workflowPolicy = "polymancer-market-research-readonly-v0";
const babyPolymancerPackId = "baby-polymancer";

const toolCallId = (runId: string, toolName: string) =>
  `${runId}-tool-${toolName.replaceAll(".", "-")}`;

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
  const input = isRecord(body.input) ? body.input : body;
  const mode = typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  if (mode !== "dry_run") {
    return {
      ok: false as const,
      response: workflowError("unsupported_execution_mode", "Only dry_run is supported."),
    };
  }

  const snapshotInput = validatePolymarketMarketSnapshotInput(input);
  if (!("code" in snapshotInput)) {
    return { ok: true as const, mode: "dry_run" as ExecutionMode, snapshotInput };
  }

  const searchInput = validatePolymarketMarketSearchInput(input);
  if (!("code" in searchInput)) {
    return { ok: true as const, mode: "dry_run" as ExecutionMode, searchInput };
  }

  return {
    ok: false as const,
    response: workflowError(
      "invalid_input",
      "Provide query, slug, or marketId for read-only market research.",
    ),
  };
};

const requireBabyPolymancerPack = async (env: Env, identity: AgentIdentity) => {
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  return pack?.id === babyPolymancerPackId
    ? { ok: true as const, pack }
    : {
        ok: false as const,
        response: workflowError(
          "pack_required",
          "polymancer.market_research requires the active Baby Polymancer agent pack.",
          403,
        ),
      };
};

const insertWorkflowStart = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    toolInput: Record<string, unknown>;
    executionMode: ExecutionMode;
  },
) => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const builtRelation = buildControlRunRelation({ runId });
  if (!builtRelation.ok) throw new Error(builtRelation.reason);
  const relation = builtRelation.relation;
  const relationData = toControlRunRelationEventData(relation);
  const execution = { mode: input.executionMode, policy: workflowPolicy };

  await env.DB.prepare(
    `INSERT INTO control_workflow_intents (
       id, user_id, workspace_id, agent_id, stage, type, execution_json, payload_json,
       status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      workflowIntentId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      "analyze",
      workflowType,
      toJson(execution),
      toJson({ input: input.toolInput }),
      "running",
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_runs (
       id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
       stage, engine, heartbeat_at, last_event_at, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      runId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      "running",
      toJson(execution),
      "analyze",
      "langgraph-declared",
      timestamp,
      timestamp,
      toJson({
        displayName: "Polymancer market research",
        workflowType,
        source: "agent-pack",
        packId: babyPolymancerPackId,
        relation,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await appendControlAudit(env, {
    ...identity,
    runId,
    workflowIntentId,
    action: "intent.created",
    summary: "Created Polymancer market research workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { relation: relationData },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "workflow.intent.created",
    summary: "Created Polymancer market research workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { runId, workflowIntentId, workflowType, relation: relationData },
  });

  return { runId, workflowIntentId, relation };
};

const insertToolCall = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    runId: string;
    workflowIntentId: string;
    toolName: string;
    status: "completed" | "failed";
    inputSummary: string;
    outputSummary: string;
    data: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const id = toolCallId(input.runId, input.toolName);
  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, output_summary, artifact_refs_json, data_json, started_at, finished_at,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.workflowIntentId,
      input.runId,
      input.toolName,
      input.status,
      input.inputSummary,
      input.outputSummary,
      "[]",
      toJson(input.data),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
  return id;
};

const finishWorkflow = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    runId: string;
    workflowIntentId: string;
    ok: boolean;
    summary: string;
    artifact?: {
      id: string;
      kind: string;
      uri: string;
      title: string;
      mimeType: string;
      sizeBytes: number;
      data: Record<string, unknown>;
    };
    data: Record<string, unknown>;
  },
) => {
  const timestamp = new Date().toISOString();
  const artifactRef = input.artifact
    ? {
        id: input.artifact.id,
        kind: input.artifact.kind,
        uri: input.artifact.uri,
        title: input.artifact.title,
        mimeType: input.artifact.mimeType,
      }
    : null;

  if (input.artifact) {
    await env.DB.prepare(
      `INSERT INTO control_artifacts (
         id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        input.artifact.id,
        identity.scope.userId,
        identity.scope.workspaceId,
        input.artifact.kind,
        input.artifact.uri,
        input.artifact.title,
        input.artifact.mimeType,
        input.artifact.sizeBytes,
        toJson(input.artifact.data),
        timestamp,
      )
      .run();

    const artifactRef = {
      id: input.artifact.id,
      kind: input.artifact.kind,
      uri: input.artifact.uri,
      title: input.artifact.title,
      mimeType: input.artifact.mimeType,
    };
    await env.DB.prepare(
      `UPDATE control_tool_calls
       SET artifact_refs_json = ?
       WHERE user_id = ? AND workspace_id = ? AND run_id = ?`,
    )
      .bind(toJson([artifactRef]), identity.scope.userId, identity.scope.workspaceId, input.runId)
      .run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_runs
       SET status = ?, last_event_at = ?, completed_at = ?, failed_at = ?, data_json = ?,
           updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    ).bind(
      input.ok ? "completed" : "failed",
      timestamp,
      input.ok ? timestamp : null,
      input.ok ? null : timestamp,
      toJson({
        summary: input.summary,
        ...input.data,
        artifactIds: artifactRef ? [artifactRef.id] : [],
      }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.runId,
    ),
    env.DB.prepare(
      `UPDATE control_workflow_intents
       SET status = ?, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ?`,
    ).bind(
      input.ok ? "completed" : "failed",
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      input.workflowIntentId,
    ),
  ]);

  await appendControlAudit(env, {
    ...identity,
    runId: input.runId,
    workflowIntentId: input.workflowIntentId,
    action: input.ok ? "run.completed" : "run.failed",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: input.data,
  });
  if (artifactRef) {
    await appendControlAudit(env, {
      ...identity,
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      action: "artifact.created",
      summary: "Created Polymancer market research artifact.",
      targetType: "artifact",
      targetId: artifactRef.id,
    });
  }
  await appendControlPlaneEvent(env, identity, {
    type: input.ok ? "workflow.run.completed" : "workflow.run.failed",
    summary: input.summary,
    targetType: "run",
    targetId: input.runId,
    data: {
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      workflowType,
      artifactId: artifactRef?.id,
    },
  });
};

const runSnapshotFromSearch = async (input: PolymarketMarketSearchInput) => {
  const search = await runPolymarketMarketSearch(input);
  if (!search.ok) return { ok: false as const, search };
  const market = search.output.markets.find((item) => item.slug && item.clobTokenIds.length > 0);
  if (!market?.slug) {
    return {
      ok: false as const,
      search,
      error: "Search returned no market with a slug and CLOB token ids.",
    };
  }
  const snapshot = await runPolymarketMarketSnapshot({ slug: market.slug });
  return { ok: snapshot.ok as boolean, search, snapshot };
};

export const handlePolymancerMarketResearch = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const pack = await requireBabyPolymancerPack(env, identity);
  if (!pack.ok) return pack.response;

  const parsed = readInput(parseJson(await request.text()));
  if (!parsed.ok) return parsed.response;

  const workflow = await insertWorkflowStart(env, identity, {
    toolInput: isRecord(parsed.searchInput ?? parsed.snapshotInput)
      ? (parsed.searchInput ?? parsed.snapshotInput)
      : {},
    executionMode: parsed.mode,
  });

  const searchResult = parsed.searchInput ? await runSnapshotFromSearch(parsed.searchInput) : null;
  if (searchResult?.search) {
    await insertToolCall(env, identity, {
      ...workflow,
      toolName: polymarketMarketSearchToolName,
      status: searchResult.search.ok ? "completed" : "failed",
      inputSummary: "Search public Polymarket markets",
      outputSummary: searchResult.search.ok
        ? searchResult.search.output.summary
        : searchResult.search.error.message,
      data: searchResult.search.ok
        ? { output: searchResult.search.output }
        : { error: searchResult.search.error },
    });
  }

  const snapshotInput = parsed.snapshotInput;
  const snapshot =
    searchResult && "snapshot" in searchResult
      ? searchResult.snapshot
      : snapshotInput
        ? await runPolymarketMarketSnapshot(snapshotInput as PolymarketMarketSnapshotInput)
        : null;

  if (!snapshot || !snapshot.ok) {
    const summary =
      snapshot && !snapshot.ok
        ? snapshot.error.message
        : (searchResult?.error ?? "Market snapshot could not be created.");
    await finishWorkflow(env, identity, {
      ...workflow,
      ok: false,
      summary,
      data: { error: summary },
    });
    return json({ ok: false, error: summary, run: workflow }, { status: 502 });
  }

  await insertToolCall(env, identity, {
    ...workflow,
    toolName: polymarketMarketSnapshotToolName,
    status: "completed",
    inputSummary: "Read public Polymarket market metadata",
    outputSummary: snapshot.output.summary,
    data: { output: snapshot.output },
  });

  const tokenId = snapshot.output.market.clobTokenIds[0];
  const orderbookInput: PolymarketOrderbookSnapshotInput | null = tokenId ? { tokenId } : null;
  const orderbook = orderbookInput ? await runPolymarketOrderbookSnapshot(orderbookInput) : null;
  if (orderbook) {
    await insertToolCall(env, identity, {
      ...workflow,
      toolName: polymarketOrderbookSnapshotToolName,
      status: orderbook.ok ? "completed" : "failed",
      inputSummary: "Read public Polymarket CLOB order book",
      outputSummary: orderbook.ok ? orderbook.output.summary : orderbook.error.message,
      data: orderbook.ok ? { output: orderbook.output } : { error: orderbook.error },
    });
  }

  const report = {
    status: "ok",
    summary: `Polymancer read-only market research completed for ${
      snapshot.output.market.question ?? snapshot.output.market.slug ?? "market"
    }.`,
    market: snapshot.output.market,
    orderbook: orderbook?.ok ? orderbook.output : null,
    risk: {
      financialData: true,
      externalMutation: false,
      requiresSecrets: false,
      trading: false,
      advice: false,
    },
  };
  const artifactData = {
    source: "polymancer_market_research",
    workflowType,
    packId: babyPolymancerPackId,
    report,
  };
  const artifact = {
    id: `${workflow.runId}-polymancer-market-research`,
    kind: "market_research_report",
    uri: `d1://control-plane/${workflow.runId}/polymancer-market-research.json`,
    title: "Polymancer market research report",
    mimeType: "application/json",
    sizeBytes: JSON.stringify(artifactData).length,
    data: artifactData,
  };

  await finishWorkflow(env, identity, {
    ...workflow,
    ok: true,
    summary: report.summary,
    artifact,
    data: {
      packId: babyPolymancerPackId,
      workflowType,
      outputSummary: report.summary,
      marketSlug: snapshot.output.market.slug,
      tokenId,
    },
  });

  return json(
    {
      ok: true,
      run: {
        id: workflow.runId,
        workflowIntentId: workflow.workflowIntentId,
        status: "completed",
        engine: "langgraph-declared",
        workflowType,
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
