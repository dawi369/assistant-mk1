import { selectAgent } from "./authz-store";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { isRecord, json, parseJson } from "./http";
import {
  finishPackWorkflowRun,
  recordPackWorkflowToolCall,
  startPackWorkflowRun,
} from "./pack-workflow-lifecycle";
import type { AgentIdentity, Env, ExecutionMode } from "./types";
import {
  runSwordfishBarsRange,
  runSwordfishRuntimeOverview,
  runSwordfishSymbolSnapshot,
  swordfishBarsRangeToolName,
  swordfishRuntimeOverviewToolName,
  swordfishSymbolSnapshotToolName,
  validateSwordfishBarsRangeInput,
  validateSwordfishSymbolSnapshotInput,
  type SwordfishBarsRangeInput,
} from "../../../lib/workbench/swordfish-readonly";

const workflowType = "swordfish.runtime_research";
const workflowPolicy = "swordfish-runtime-research-readonly-v0";
const babySwordfishPackId = "baby-swordfish";

type WorkflowInput = {
  symbol?: string;
  tf?: SwordfishBarsRangeInput["tf"];
  lookbackMinutes?: number;
  endMs?: number;
  maxBars?: number;
  includeBars: boolean;
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
  const input = isRecord(body.input) ? body.input : body;
  const mode = typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  if (mode !== "dry_run") {
    return {
      ok: false as const,
      response: workflowError("unsupported_execution_mode", "Only dry_run is supported."),
    };
  }

  const supported = new Set(["symbol", "tf", "lookbackMinutes", "endMs", "maxBars", "includeBars"]);
  const forbidden = new Set([
    "url",
    "endpoint",
    "host",
    "headers",
    "authorization",
    "apiKey",
    "api_key",
    "secret",
    "token",
    "admin",
    "method",
    "body",
  ]);
  for (const key of Object.keys(input)) {
    if (forbidden.has(key) || !supported.has(key)) {
      return {
        ok: false as const,
        response: workflowError("invalid_input", `${key} is not supported by ${workflowType}.`),
      };
    }
  }

  if (input.includeBars !== undefined && typeof input.includeBars !== "boolean") {
    return {
      ok: false as const,
      response: workflowError("invalid_input", "includeBars must be a boolean."),
    };
  }

  const barsInput = validateSwordfishBarsRangeInput({
    symbol: typeof input.symbol === "string" ? input.symbol : "ESH6",
    tf: input.tf,
    lookbackMinutes: input.lookbackMinutes,
    endMs: input.endMs,
    maxBars: input.maxBars,
  });
  if ("code" in barsInput) {
    return {
      ok: false as const,
      response: workflowError("invalid_input", barsInput.message),
    };
  }

  if (input.symbol !== undefined) {
    const snapshotInput = validateSwordfishSymbolSnapshotInput({ symbol: input.symbol });
    if ("code" in snapshotInput) {
      return {
        ok: false as const,
        response: workflowError("invalid_input", snapshotInput.message),
      };
    }
    return {
      ok: true as const,
      mode: "dry_run" as ExecutionMode,
      input: {
        symbol: snapshotInput.symbol,
        tf: barsInput.tf,
        lookbackMinutes: barsInput.lookbackMinutes,
        endMs: barsInput.endMs,
        maxBars: barsInput.maxBars,
        includeBars: input.includeBars !== false,
      } satisfies WorkflowInput,
    };
  }

  return {
    ok: true as const,
    mode: "dry_run" as ExecutionMode,
    input: {
      tf: barsInput.tf,
      lookbackMinutes: barsInput.lookbackMinutes,
      endMs: barsInput.endMs,
      maxBars: barsInput.maxBars,
      includeBars: input.includeBars !== false,
    } satisfies WorkflowInput,
  };
};

const requireBabySwordfishPack = async (env: Env, identity: AgentIdentity) => {
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  return pack?.id === babySwordfishPackId
    ? { ok: true as const, pack }
    : {
        ok: false as const,
        response: workflowError(
          "pack_required",
          "swordfish.runtime_research requires the active Baby Swordfish agent pack.",
          403,
        ),
      };
};

export const handleSwordfishRuntimeResearch = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const pack = await requireBabySwordfishPack(env, identity);
  if (!pack.ok) return pack.response;

  const parsed = readInput(parseJson(await request.text()));
  if (!parsed.ok) return parsed.response;

  const workflow = await startPackWorkflowRun(env, identity, {
    workflowType,
    policyReference: workflowPolicy,
    displayName: "Swordfish runtime research",
    packId: babySwordfishPackId,
    toolInput: parsed.input as Record<string, unknown>,
    executionMode: parsed.mode,
    intentCreatedSummary: "Created Swordfish runtime research workflow intent.",
  });

  const overview = await runSwordfishRuntimeOverview({});
  await recordPackWorkflowToolCall(env, identity, {
    ...workflow,
    toolName: swordfishRuntimeOverviewToolName,
    status: overview.ok ? "completed" : "failed",
    inputSummary: "Read public Swordfish runtime overview",
    outputSummary: overview.ok ? overview.output.summary : overview.error.message,
    data: overview.ok ? { output: overview.output } : { error: overview.error },
  });

  if (!overview.ok) {
    await finishPackWorkflowRun(env, identity, {
      ...workflow,
      workflowType,
      ok: false,
      summary: overview.error.message,
      data: { error: overview.error, packId: babySwordfishPackId, workflowType },
    });
    return json({ ok: false, error: overview.error.message, run: workflow }, { status: 502 });
  }

  const selectedSymbol =
    parsed.input.symbol ?? overview.output.openTicker ?? overview.output.sampleSymbols[0];
  const snapshot = selectedSymbol
    ? await runSwordfishSymbolSnapshot({ symbol: selectedSymbol })
    : null;
  if (snapshot) {
    await recordPackWorkflowToolCall(env, identity, {
      ...workflow,
      toolName: swordfishSymbolSnapshotToolName,
      status: snapshot.ok ? "completed" : "failed",
      inputSummary: `Read public Swordfish snapshot for ${selectedSymbol}`,
      outputSummary: snapshot.ok ? snapshot.output.summary : snapshot.error.message,
      data: snapshot.ok ? { output: snapshot.output } : { error: snapshot.error },
    });
  }

  const barsInput =
    selectedSymbol && parsed.input.includeBars
      ? validateSwordfishBarsRangeInput({
          symbol: selectedSymbol,
          tf: parsed.input.tf,
          lookbackMinutes: parsed.input.lookbackMinutes,
          endMs: parsed.input.endMs,
          maxBars: parsed.input.maxBars,
        })
      : null;
  const bars = barsInput && !("code" in barsInput) ? await runSwordfishBarsRange(barsInput) : null;
  if (barsInput && "code" in barsInput) {
    await recordPackWorkflowToolCall(env, identity, {
      ...workflow,
      toolName: swordfishBarsRangeToolName,
      status: "failed",
      inputSummary: selectedSymbol
        ? `Read public Swordfish bars for ${selectedSymbol}`
        : "Read public Swordfish bars",
      outputSummary: barsInput.message,
      data: { error: barsInput },
    });
  } else if (bars) {
    await recordPackWorkflowToolCall(env, identity, {
      ...workflow,
      toolName: swordfishBarsRangeToolName,
      status: bars.ok ? "completed" : "failed",
      inputSummary: `Read public Swordfish bars for ${selectedSymbol}`,
      outputSummary: bars.ok ? bars.output.summary : bars.error.message,
      data: bars.ok ? { output: bars.output } : { error: bars.error },
    });
  }

  const report = {
    status: "ok",
    summary: `Swordfish read-only runtime research completed: ${overview.output.summary}`,
    overview: overview.output,
    symbol: selectedSymbol ?? null,
    snapshot: snapshot?.ok ? snapshot.output : null,
    bars: bars?.ok ? bars.output : null,
    warnings: [
      !selectedSymbol ? "No public symbol was available for symbol-level inspection." : null,
      snapshot && !snapshot.ok ? snapshot.error.message : null,
      bars && !bars.ok ? bars.error.message : null,
      barsInput && "code" in barsInput ? barsInput.message : null,
    ].filter((item): item is string => typeof item === "string"),
    risk: {
      financialData: true,
      externalMutation: false,
      requiresSecrets: false,
      adminEndpoints: false,
      trading: false,
      advice: false,
    },
  };
  const artifactData = {
    source: "swordfish_runtime_research",
    workflowType,
    packId: babySwordfishPackId,
    report,
  };
  const artifact = {
    id: `${workflow.runId}-swordfish-runtime-research`,
    kind: "runtime_research_report",
    uri: `d1://control-plane/${workflow.runId}/swordfish-runtime-research.json`,
    title: "Swordfish runtime research report",
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
    artifactCreatedSummary: "Created Swordfish runtime research artifact.",
    data: {
      packId: babySwordfishPackId,
      workflowType,
      outputSummary: report.summary,
      symbol: selectedSymbol ?? null,
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
