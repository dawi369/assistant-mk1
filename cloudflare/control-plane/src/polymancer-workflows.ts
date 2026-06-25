import { selectAgent } from "./authz-store";
import { isRecord, json, parseJson } from "./http";
import { resolveAgentBehaviorConfig } from "./agent-records";
import {
  finishPackWorkflowRun,
  recordPackWorkflowToolCall,
  startPackWorkflowRun,
} from "./pack-workflow-lifecycle";
import type { AgentIdentity, Env, ExecutionMode } from "./types";
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

  const workflow = await startPackWorkflowRun(env, identity, {
    workflowType,
    policyReference: workflowPolicy,
    displayName: "Polymancer market research",
    packId: babyPolymancerPackId,
    toolInput: isRecord(parsed.searchInput ?? parsed.snapshotInput)
      ? (parsed.searchInput ?? parsed.snapshotInput)
      : {},
    executionMode: parsed.mode,
    intentCreatedSummary: "Created Polymancer market research workflow intent.",
  });

  const searchResult = parsed.searchInput ? await runSnapshotFromSearch(parsed.searchInput) : null;
  if (searchResult?.search) {
    await recordPackWorkflowToolCall(env, identity, {
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
    await finishPackWorkflowRun(env, identity, {
      ...workflow,
      workflowType,
      ok: false,
      summary,
      data: { error: summary },
    });
    return json({ ok: false, error: summary, run: workflow }, { status: 502 });
  }

  await recordPackWorkflowToolCall(env, identity, {
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
    await recordPackWorkflowToolCall(env, identity, {
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

  await finishPackWorkflowRun(env, identity, {
    ...workflow,
    workflowType,
    ok: true,
    summary: report.summary,
    artifact,
    artifactCreatedSummary: "Created Polymancer market research artifact.",
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
