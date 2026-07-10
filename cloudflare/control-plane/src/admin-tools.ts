import { selectAgent, selectMembership } from "./authz-store";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { isRecord, json, parseDataJson, parseJson } from "./http";
import { toHumanInterventionEventData, toHumanInterventionSummary } from "./human-interventions";
import { isAdminMembership } from "./membership-policy";
import {
  adminTestToolError,
  artifactMetadataTestPolicy,
  artifactMetadataTestToolName,
  diagnosticPingPolicy,
  diagnosticPingToolName,
  runnerEchoAdapterVersion,
  runnerEchoPolicy,
  runnerEchoToolName,
  validateArtifactMetadataTestInput,
  validateDiagnosticPingInput,
  validateRunnerEchoInput,
  type AdminTestToolResult,
  type ArtifactMetadataTestResult,
  type DiagnosticPingResult,
  type RunnerEchoResult,
} from "../../../lib/workbench/admin-test-tools";
import {
  inspectUrl,
  urlInspectError,
  validateUrlInspectInput,
  type UrlInspectResult,
} from "../../../lib/workbench/url-inspect";
import {
  repoSnapshotAdapterVersion,
  repoSnapshotError,
  repoSnapshotPolicy,
  repoSnapshotToolName,
  validateRepoSnapshotInput,
  type RepoSnapshotResult,
} from "../../../lib/workbench/repo-snapshot";
import {
  isPolymarketReadonlyToolName,
  polymarketMarketSearchToolName,
  polymarketMarketSnapshotToolName,
  polymarketOrderbookSnapshotToolName,
  polymarketReadonlyAdapterVersion,
  polymarketReadonlyPolicy,
  runPolymarketReadonlyTool,
  validatePolymarketMarketSearchInput,
  validatePolymarketMarketSnapshotInput,
  validatePolymarketOrderbookSnapshotInput,
  type PolymarketReadonlyResult,
} from "../../../lib/workbench/polymarket-readonly";
import {
  isSwordfishReadonlyToolName,
  runSwordfishReadonlyTool,
  swordfishBarsRangeToolName,
  swordfishReadonlyAdapterVersion,
  swordfishReadonlyPolicy,
  swordfishRuntimeOverviewToolName,
  swordfishSymbolSnapshotToolName,
  validateSwordfishBarsRangeInput,
  validateSwordfishRuntimeOverviewInput,
  validateSwordfishSymbolSnapshotInput,
  type SwordfishReadonlyResult,
} from "../../../lib/workbench/swordfish-readonly";
import {
  finishTrace,
  recordIncomingRequestSpans,
  recordSpan,
  startTrace,
  type IncomingRuntimeTrace,
  type RuntimeTraceContext,
} from "./runtime-traces";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import { applyWorkflowCallbackPayload } from "./workflow-callbacks";
import {
  readDynamicCapabilityContext,
  resolveDynamicToolCapabilities,
  type DynamicCapabilityContext,
  type DynamicCapabilityDecision,
} from "./dynamic-capabilities";
import { connectionAuthForTool } from "./connection-auth";
import {
  buildControlRunRelation,
  readControlRunRelation,
  toControlRunRelationEventData,
  type ControlRunRelation,
  type ControlRunRelationParent,
} from "./run-relations";
import {
  demoInspectToolName,
  evaluateToolPolicy,
  isKnownTool,
  isPolicyEditableTool,
  recordToolPolicyDecision,
  toolPolicyError,
  updateToolPermissionStatus,
  urlInspectPolicy,
  urlInspectToolName,
} from "./tool-policy";
import {
  cloudflareInlineRunnerTransport,
  invokeFlyToolRunner,
  runnerMetadataFor,
  resolveConfiguredRunnerTransport,
  runnerEchoSandboxContract,
  type ToolAdapterMetadata,
  type ToolRunnerSandboxContract,
  type ToolRunnerMetadata,
  repoSnapshotSandboxContract,
  urlInspectSandboxContract,
} from "./tool-runner";
import {
  createId,
  toJson,
  type AgentIdentity,
  type ControlApprovalRequestRow,
  type ControlArtifactRow,
  type ControlRunRow,
  type ControlToolCallRow,
  type Env,
  type ExecutionMode,
  type RunStatus,
  type TenantScope,
  type ToolPermissionStatus,
} from "./types";

const urlInspectWorkflowType = "tool.url.inspect";
const urlInspectAdapterVersion = "url-inspect-v1";
const repoSnapshotWorkflowType = "tool.repo.snapshot";
const diagnosticPingWorkflowType = "tool.diagnostic.ping";
const runnerEchoWorkflowType = "tool.runner.echo";
const artifactMetadataTestWorkflowType = "tool.artifact.metadata.test";
const polymarketMarketSearchWorkflowType = "tool.polymarket.market.search";
const polymarketMarketSnapshotWorkflowType = "tool.polymarket.market.snapshot";
const polymarketOrderbookSnapshotWorkflowType = "tool.polymarket.orderbook.snapshot";
const swordfishRuntimeOverviewWorkflowType = "tool.swordfish.runtime.overview";
const swordfishSymbolSnapshotWorkflowType = "tool.swordfish.symbol.snapshot";
const swordfishBarsRangeWorkflowType = "tool.swordfish.bars.range";

type ToolRunIdentity = AgentIdentity & {
  runId: string;
  workflowIntentId: string;
  source?: "admin" | "approval" | "model";
  runner?: ToolRunnerMetadata;
  relation?: ControlRunRelation;
};

type UrlInspectRunSource = "admin" | "approval" | "model";
type InlineToolResult = AdminTestToolResult | PolymarketReadonlyResult | SwordfishReadonlyResult;

const urlInspectAdapter: ToolAdapterMetadata = {
  toolName: urlInspectToolName,
  adapterVersion: urlInspectAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const demoInspectAdapter: ToolAdapterMetadata = {
  toolName: demoInspectToolName,
  adapterVersion: "demo-inspect-compat-v1",
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const repoSnapshotAdapter: ToolAdapterMetadata = {
  toolName: repoSnapshotToolName,
  adapterVersion: repoSnapshotAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: "fly",
};

const diagnosticPingAdapter: ToolAdapterMetadata = {
  toolName: diagnosticPingToolName,
  adapterVersion: "diagnostic-ping-v1",
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const runnerEchoAdapter: ToolAdapterMetadata = {
  toolName: runnerEchoToolName,
  adapterVersion: runnerEchoAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: "fly",
};

const artifactMetadataTestAdapter: ToolAdapterMetadata = {
  toolName: artifactMetadataTestToolName,
  adapterVersion: "artifact-metadata-test-v1",
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const polymarketMarketSearchAdapter: ToolAdapterMetadata = {
  toolName: polymarketMarketSearchToolName,
  adapterVersion: polymarketReadonlyAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const polymarketMarketSnapshotAdapter: ToolAdapterMetadata = {
  toolName: polymarketMarketSnapshotToolName,
  adapterVersion: polymarketReadonlyAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const polymarketOrderbookSnapshotAdapter: ToolAdapterMetadata = {
  toolName: polymarketOrderbookSnapshotToolName,
  adapterVersion: polymarketReadonlyAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const swordfishRuntimeOverviewAdapter: ToolAdapterMetadata = {
  toolName: swordfishRuntimeOverviewToolName,
  adapterVersion: swordfishReadonlyAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const swordfishSymbolSnapshotAdapter: ToolAdapterMetadata = {
  toolName: swordfishSymbolSnapshotToolName,
  adapterVersion: swordfishReadonlyAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const swordfishBarsRangeAdapter: ToolAdapterMetadata = {
  toolName: swordfishBarsRangeToolName,
  adapterVersion: swordfishReadonlyAdapterVersion,
  supportedExecutionModes: ["dry_run"],
  transport: cloudflareInlineRunnerTransport,
};

const toolSummaries = [
  {
    name: demoInspectToolName,
    description: "Run the deterministic workspace diagnostic.",
    kind: "native",
    family: "diagnostic",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(demoInspectAdapter, "demo-compat"),
  },
  {
    name: urlInspectToolName,
    description: "Inspect a public URL with a bounded read-only HTTP request.",
    kind: "native",
    family: "web",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(urlInspectAdapter, "admin"),
  },
  {
    name: repoSnapshotToolName,
    description: "Capture a bounded read-only repository snapshot using CLI inspection.",
    kind: "cli",
    family: "repo",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(repoSnapshotAdapter, "admin", "fly", repoSnapshotSandboxContract()),
  },
  {
    name: diagnosticPingToolName,
    description: "Run a deterministic Admin conformance ping.",
    kind: "native",
    family: "diagnostic",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(diagnosticPingAdapter, "admin"),
  },
  {
    name: runnerEchoToolName,
    description: "Echo bounded input through the signed Fly runner callback path.",
    kind: "cli",
    family: "diagnostic",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(runnerEchoAdapter, "admin", "fly", runnerEchoSandboxContract()),
  },
  {
    name: artifactMetadataTestToolName,
    description: "Create a metadata-only conformance artifact reference.",
    kind: "native",
    family: "diagnostic",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(artifactMetadataTestAdapter, "admin"),
  },
  {
    name: polymarketMarketSearchToolName,
    description: "Search public Polymarket markets using bounded no-auth market data.",
    kind: "native",
    family: "finance",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(polymarketMarketSearchAdapter, "admin"),
  },
  {
    name: polymarketMarketSnapshotToolName,
    description: "Read compact public Polymarket market metadata and outcome pricing.",
    kind: "native",
    family: "finance",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(polymarketMarketSnapshotAdapter, "admin"),
  },
  {
    name: polymarketOrderbookSnapshotToolName,
    description: "Read compact public Polymarket CLOB order book depth for a token id.",
    kind: "native",
    family: "finance",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(polymarketOrderbookSnapshotAdapter, "admin"),
  },
  {
    name: swordfishRuntimeOverviewToolName,
    description: "Read public Swordfish runtime health, open ticker, symbols, and snapshot count.",
    kind: "native",
    family: "finance",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(swordfishRuntimeOverviewAdapter, "admin"),
  },
  {
    name: swordfishSymbolSnapshotToolName,
    description: "Read a compact public Swordfish futures symbol snapshot.",
    kind: "native",
    family: "finance",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(swordfishSymbolSnapshotAdapter, "admin"),
  },
  {
    name: swordfishBarsRangeToolName,
    description: "Read a bounded public Swordfish bar range for a futures symbol.",
    kind: "native",
    family: "finance",
    status: "available",
    supportedExecutionModes: ["dry_run"],
    requiresSecrets: false,
    mutationRisk: "read_only",
    runner: runnerMetadataFor(swordfishBarsRangeAdapter, "admin"),
  },
] as const;

const scopeFromRow = (row: { user_id: string; workspace_id: string }): TenantScope => ({
  userId: row.user_id,
  workspaceId: row.workspace_id,
});

const toToolCallSummary = (row: ControlToolCallRow) => {
  const data = parseDataJson(row.data_json);
  return {
    id: row.id,
    scope: scopeFromRow(row),
    agentId: row.agent_id,
    workflowIntentId: row.workflow_intent_id,
    runId: row.run_id,
    toolId: row.tool_id,
    status: row.status,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    artifactRefs: parseJson(row.artifact_refs_json) ?? [],
    relation: readControlRunRelation(data) ?? undefined,
    data,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
  };
};

const toArtifactSummary = (row: ControlArtifactRow) => ({
  id: row.id,
  scope: scopeFromRow(row),
  kind: row.kind,
  uri: row.uri,
  title: row.title ?? undefined,
  mimeType: row.mime_type ?? undefined,
  sizeBytes: row.size_bytes ?? undefined,
  data: parseDataJson(row.data_json),
  createdAt: row.created_at,
});

const toApprovalRequestSummary = (row: ControlApprovalRequestRow) => ({
  id: row.id,
  scope: scopeFromRow(row),
  agentId: row.agent_id,
  workflowIntentId: row.workflow_intent_id,
  runId: row.run_id,
  toolId: row.tool_id,
  status: row.status,
  reason: row.reason,
  data: parseDataJson(row.data_json),
  humanIntervention: toHumanInterventionSummary(row),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toPolicySummary = (policy: Awaited<ReturnType<typeof evaluateToolPolicy>>) => ({
  decision: policy.decision,
  code: policy.code,
  reason: policy.reason,
  executionMode: policy.executionMode,
  policyReference: policy.policyReference,
  constraints: policy.constraints,
});

const capabilityForTool = (
  decisions: DynamicCapabilityDecision[],
  toolName: string,
): DynamicCapabilityDecision | undefined =>
  decisions.find((decision) => decision.kind === "tool" && decision.capabilityId === toolName);

const resolveActivePackToolDeclarations = async (env: Env, identity: AgentIdentity) => {
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const pack = resolveAgentBehaviorConfig(agent).pack;
  return {
    pack,
    declarations: new Map((pack?.tools ?? []).map((tool) => [tool.id, tool] as const)),
  };
};

const readLatestApprovalRequest = async (env: Env, identity: AgentIdentity, toolName: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            reason, data_json, created_at, updated_at
     FROM control_approval_requests
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND tool_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, toolName)
    .first<ControlApprovalRequestRow>();

export const listLatestToolCalls = async (env: Env, scope: TenantScope, limit = 8) => {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            input_summary, output_summary, artifact_refs_json, data_json, started_at,
            finished_at, created_at
     FROM control_tool_calls
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, limit)
    .all<ControlToolCallRow>();

  return rows.results.map(toToolCallSummary);
};

export const listLatestArtifacts = async (env: Env, scope: TenantScope, limit = 8) => {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json,
            created_at
     FROM control_artifacts
     WHERE user_id = ? AND workspace_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(scope.userId, scope.workspaceId, limit)
    .all<ControlArtifactRow>();

  return rows.results.map(toArtifactSummary);
};

export const resolveToolSummaries = async (
  env: Env,
  identity: AgentIdentity,
  capabilityContext: DynamicCapabilityContext = readDynamicCapabilityContext(),
) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const packScope = await resolveActivePackToolDeclarations(env, identity);
  const capabilityDecisions = await resolveDynamicToolCapabilities(
    env,
    identity,
    capabilityContext,
  );
  const tools = await Promise.all(
    toolSummaries.map(async (tool) => {
      const adminPolicy = await evaluateToolPolicy(env, identity, {
        membership,
        toolName: tool.name,
        executionMode: "dry_run",
        surface: "admin_list",
      });
      const modelPolicy = await evaluateToolPolicy(env, identity, {
        membership,
        toolName: tool.name,
        executionMode: "dry_run",
        surface: "model_exposure",
      });
      const latestApprovalRequest = await readLatestApprovalRequest(env, identity, tool.name);
      const permission = adminPolicy.permission ?? modelPolicy.permission;
      const permissionData = parseDataJson(permission?.data_json ?? "{}");
      const killSwitchReason =
        typeof permissionData.killSwitchReason === "string"
          ? permissionData.killSwitchReason
          : undefined;
      const capability = capabilityForTool(capabilityDecisions, tool.name);
      const packTool = packScope.declarations.get(tool.name);

      const reason =
        adminPolicy.decision === "allow"
          ? `${adminPolicy.reason} ${modelPolicy.reason}`
          : adminPolicy.reason;

      return {
        ...tool,
        runner:
          tool.name === urlInspectToolName
            ? urlInspectRunnerMetadata(env, "admin", adminPolicy.constraints)
            : tool.name === repoSnapshotToolName
              ? repoSnapshotRunnerMetadata("admin", adminPolicy.constraints)
              : tool.name === runnerEchoToolName
                ? runnerEchoRunnerMetadata("admin", adminPolicy.constraints)
                : tool.runner,
        adminVisible: adminPolicy.decision === "allow" && adminPolicy.adminVisible,
        modelVisible: modelPolicy.decision === "allow" && modelPolicy.modelVisible,
        reason,
        permissionStatus: permission?.status,
        policyReference: adminPolicy.policyReference,
        allowedExecutionModes: adminPolicy.allowedExecutionModes,
        approvalRequired: adminPolicy.approvalRequired,
        killSwitchReason,
        policyEditable: adminPolicy.policyEditable,
        policyConstraints: adminPolicy.constraints,
        connectionAuth: connectionAuthForTool(tool.name),
        adminPolicy: toPolicySummary(adminPolicy),
        modelExposurePolicy: toPolicySummary(modelPolicy),
        capability,
        packScope: packScope.pack
          ? {
              activePackId: packScope.pack.id,
              declared: Boolean(packTool),
              invocation: packTool?.invocation,
              required: packTool?.required,
              modelVisibleDefault: packTool?.modelVisibleDefault,
              executionModes: packTool ? [...packTool.executionModes] : undefined,
              purpose: packTool?.purpose,
            }
          : undefined,
        latestApprovalRequest: latestApprovalRequest
          ? toApprovalRequestSummary(latestApprovalRequest)
          : undefined,
      };
    }),
  );

  return {
    context: capabilityContext,
    decisions: capabilityDecisions,
    tools,
  };
};

const toolError = urlInspectError;

const urlPolicyResource = (url: URL) => ({
  kind: "url" as const,
  value: url.toString(),
  host: url.hostname.toLowerCase(),
});

const externalParentRelation = (parentRunId: string): ControlRunRelation => ({
  kind: "child",
  parentRunId,
  rootRunId: parentRunId,
  depth: 1,
  durableChild: false,
});

const relationEventData = (relation?: ControlRunRelation) =>
  relation ? toControlRunRelationEventData(relation) : undefined;

const repoSnapshotToolCallId = (runId: string) => `${runId}-tool-repo-snapshot`;
const repoSnapshotArtifactId = (runId: string) => `${runId}-artifact-repo-snapshot`;
const repoSnapshotArtifactUri = (runId: string) =>
  `d1://control-plane/${runId}/repo-snapshot-report.json`;
const terminalRunStatuses = new Set<RunStatus>(["completed", "failed", "cancelled"]);

const isUrlInspectResult = (result: unknown): result is UrlInspectResult =>
  isRecord(result) &&
  typeof result.ok === "boolean" &&
  (result.ok === false ||
    (isRecord(result.output) && "finalUrl" in result.output && "downloadedBytes" in result.output));

const readParentControlRun = async (
  env: Env,
  identity: AgentIdentity,
  parentRunId: string,
): Promise<ControlRunRelationParent | null> => {
  const row = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
            stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
            created_at, updated_at
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, parentRunId)
    .first<ControlRunRow>();

  return row ? { id: row.id, data: parseDataJson(row.data_json) } : null;
};

const urlInspectRunnerMetadata = (
  env: Env,
  source: UrlInspectRunSource,
  constraints?: {
    allowlist?: string[];
    denylist?: string[];
    maxRuntimeMs?: number;
  },
): ToolRunnerMetadata =>
  runnerMetadataFor(
    urlInspectAdapter,
    source,
    resolveConfiguredRunnerTransport(env),
    urlInspectSandboxContract(constraints),
  );

const repoSnapshotRunnerMetadata = (
  source: UrlInspectRunSource,
  constraints?: {
    maxRuntimeMs?: number;
  },
): ToolRunnerMetadata =>
  runnerMetadataFor(
    repoSnapshotAdapter,
    source,
    "fly",
    repoSnapshotSandboxContract({ maxRuntimeMs: constraints?.maxRuntimeMs }),
  );

const runnerEchoRunnerMetadata = (
  source: UrlInspectRunSource,
  constraints?: {
    maxRuntimeMs?: number;
  },
): ToolRunnerMetadata =>
  runnerMetadataFor(
    runnerEchoAdapter,
    source,
    "fly",
    runnerEchoSandboxContract({ maxRuntimeMs: constraints?.maxRuntimeMs }),
  );

const sandboxTraceData = (sandbox?: ToolRunnerSandboxContract) =>
  sandbox
    ? {
        lifecycle: sandbox.lifecycle,
        network: {
          egress: sandbox.network.egress,
          allowedSchemes: sandbox.network.allowedSchemes,
          allowedHosts: sandbox.network.allowedHosts,
          deniedHosts: sandbox.network.deniedHosts,
          privateNetwork: sandbox.network.privateNetwork,
          enforcement: sandbox.network.enforcement,
        },
        limits: sandbox.limits,
      }
    : undefined;

type RunnerDispatchTraceResult =
  | {
      ok: true;
      output: { status?: unknown };
      metrics?: Record<string, unknown>;
    }
  | {
      ok: false;
      error?: { code?: unknown };
      metrics?: Record<string, unknown>;
    };

const runnerDispatchTraceData = (
  runner: ToolRunnerMetadata,
  result: RunnerDispatchTraceResult,
  durationMs: number,
) => {
  const metrics = isRecord(result.metrics) ? result.metrics : {};
  const runnerStatus = result.ok ? "completed" : "failed";
  const responseStatus =
    typeof metrics.status === "number" || typeof metrics.status === "string"
      ? metrics.status
      : result.ok
        ? result.output.status
        : undefined;
  const remoteDurationMs =
    typeof metrics.durationMs === "number" && Number.isFinite(metrics.durationMs)
      ? Math.max(0, Math.round(metrics.durationMs))
      : undefined;

  return {
    runner: {
      transport: runner.transport,
      adapterVersion: runner.adapterVersion,
      source: runner.source,
      sandbox: sandboxTraceData(runner.sandbox),
      durationMs,
      status: runnerStatus,
      errorCode: result.ok ? undefined : result.error?.code,
      responseStatus,
      remoteDurationMs,
    },
  };
};

export const insertToolRunRecords = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    url: URL;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    source?: UrlInspectRunSource;
    parentRunId?: string | null;
    parentRun?: ControlRunRelationParent | null;
    traceId?: string | null;
    sandboxConstraints?: {
      allowlist?: string[];
      denylist?: string[];
      maxRuntimeMs?: number;
    };
  },
): Promise<ToolRunIdentity> => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const toolCallId = `${runId}-tool-url-inspect`;
  const execution = { mode: input.executionMode, policy: urlInspectPolicy };
  const source = input.source ?? "admin";
  const runner = urlInspectRunnerMetadata(env, source, input.sandboxConstraints);
  const normalizedInput = { url: input.url.toString() };
  const builtRelation = input.parentRun
    ? buildControlRunRelation({ runId, parent: input.parentRun })
    : input.parentRunId
      ? { ok: true as const, relation: externalParentRelation(input.parentRunId) }
      : buildControlRunRelation({ runId });
  if (!builtRelation.ok) {
    throw new Error(builtRelation.reason);
  }
  const relation = builtRelation.relation;
  const relationData = toControlRunRelationEventData(relation);

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
      "observe",
      urlInspectWorkflowType,
      toJson(execution),
      toJson({ toolName: urlInspectToolName, input: normalizedInput, runner }),
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
      "observe",
      "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        toolName: urlInspectToolName,
        policy: urlInspectPolicy,
        policyDecisionId: input.policyDecisionId,
        source,
        runner,
        relation,
        parentRunId: relation.parentRunId,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, artifact_refs_json, data_json, started_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      runId,
      urlInspectToolName,
      "running",
      `Inspect ${input.url.toString()}`,
      "[]",
      toJson({
        input: normalizedInput,
        execution,
        source,
        runner,
        resource: urlPolicyResource(input.url),
        policyDecisionId: input.policyDecisionId,
        relation,
        parentRunId: relation.parentRunId,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = { ...identity, runId, workflowIntentId, source, runner, relation };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "intent.created",
    summary: "Created URL inspection workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { relation: relationData },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "tool.started",
    summary: "Started url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: { relation: relationData },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.started",
    summary: "Started url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId,
      workflowIntentId,
      toolName: urlInspectToolName,
      source,
      runner,
      relation: relationData,
      parentRunId: relation.parentRunId,
      traceId: input.traceId ?? undefined,
    },
  });

  return runIdentity;
};

const insertRepoSnapshotRunRecords = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    snapshotInput: Record<string, unknown>;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    traceId?: string | null;
    sandboxConstraints?: {
      maxRuntimeMs?: number;
    };
  },
): Promise<ToolRunIdentity> => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const toolCallId = `${runId}-tool-repo-snapshot`;
  const execution = { mode: input.executionMode, policy: repoSnapshotPolicy };
  const runner = repoSnapshotRunnerMetadata("admin", input.sandboxConstraints);
  const builtRelation = buildControlRunRelation({ runId });
  if (!builtRelation.ok) throw new Error(builtRelation.reason);
  const relation = builtRelation.relation;
  const relationData = toControlRunRelationEventData(relation);

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
      "observe",
      repoSnapshotWorkflowType,
      toJson(execution),
      toJson({ toolName: repoSnapshotToolName, input: input.snapshotInput, runner }),
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
      "observe",
      "fly-tool-runner",
      timestamp,
      timestamp,
      toJson({
        displayName: "Repository snapshot",
        toolName: repoSnapshotToolName,
        policy: repoSnapshotPolicy,
        policyDecisionId: input.policyDecisionId,
        source: "admin",
        runner,
        relation,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, artifact_refs_json, data_json, started_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      runId,
      repoSnapshotToolName,
      "running",
      "Capture bounded repository snapshot",
      "[]",
      toJson({
        input: input.snapshotInput,
        execution,
        source: "admin",
        runner,
        policyDecisionId: input.policyDecisionId,
        relation,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = {
    ...identity,
    runId,
    workflowIntentId,
    source: "admin" as const,
    runner,
    relation,
  };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "intent.created",
    summary: "Created repo.snapshot workflow intent.",
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { relation: relationData },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "tool.started",
    summary: "Started repo.snapshot tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: { relation: relationData },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.started",
    summary: "Started repo.snapshot tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId,
      workflowIntentId,
      toolName: repoSnapshotToolName,
      source: "admin",
      runner,
      relation: relationData,
      traceId: input.traceId ?? undefined,
    },
  });

  return runIdentity;
};

const insertApprovalInterruptedRun = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    url: URL;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    reason: string;
    sandboxConstraints?: {
      allowlist?: string[];
      denylist?: string[];
      maxRuntimeMs?: number;
    };
  },
) => {
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const approvalRequestId = createId("cf-approval");
  const execution = { mode: input.executionMode, policy: urlInspectPolicy };
  const runner = urlInspectRunnerMetadata(env, "approval", input.sandboxConstraints);
  const normalizedInput = { url: input.url.toString() };
  const payload = { toolName: urlInspectToolName, input: normalizedInput, runner };

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
      "observe",
      urlInspectWorkflowType,
      toJson(execution),
      toJson(payload),
      "interrupted",
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
      "interrupted",
      toJson(execution),
      "observe",
      "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        summary: input.reason,
        toolName: urlInspectToolName,
        policy: urlInspectPolicy,
        policyDecisionId: input.policyDecisionId,
        approvalRequestId,
        runner,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_approval_requests (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       reason, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      approvalRequestId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      runId,
      urlInspectToolName,
      "requested",
      input.reason,
      toJson({
        input: normalizedInput,
        execution,
        source: "admin",
        runner,
        resource: urlPolicyResource(input.url),
        policyDecisionId: input.policyDecisionId,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = { ...identity, runId, workflowIntentId };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "run.interrupted",
    summary: input.reason,
    targetType: "run",
    targetId: runId,
    data: { toolName: urlInspectToolName, approvalRequestId, runner },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "approval.requested",
    summary: input.reason,
    targetType: "approvalRequest",
    targetId: approvalRequestId,
    data: { toolName: urlInspectToolName, runner },
  });
  const humanIntervention = toHumanInterventionEventData({
    approvalRequestId,
    status: "requested",
    runId,
    workflowIntentId,
    toolName: urlInspectToolName,
    reason: input.reason,
  });

  await appendControlPlaneEvent(env, identity, {
    type: "run.interrupted",
    summary: input.reason,
    targetType: "run",
    targetId: runId,
    data: {
      runId,
      workflowIntentId,
      toolName: urlInspectToolName,
      approvalRequestId,
      runner,
      humanIntervention,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "approval.requested",
    summary: input.reason,
    targetType: "approvalRequest",
    targetId: approvalRequestId,
    data: { runId, workflowIntentId, toolName: urlInspectToolName, runner, humanIntervention },
  });

  return { runId, workflowIntentId, approvalRequestId };
};

export const finishToolRun = async (
  env: Env,
  identity: ToolRunIdentity,
  result: UrlInspectResult,
) => {
  const timestamp = new Date().toISOString();
  const toolCallId = `${identity.runId}-tool-url-inspect`;
  const artifactId = `${identity.runId}-artifact-url-inspect`;
  const runner = identity.runner ?? urlInspectRunnerMetadata(env, identity.source ?? "admin");
  const relation = relationEventData(identity.relation);
  const artifactRef = {
    id: artifactId,
    kind: "report",
    uri: `d1://control-plane/${identity.runId}/url-inspect-report.json`,
    title: "URL inspection report",
    mimeType: "application/json",
  };

  if (!result.ok) {
    await env.DB.prepare(
      `UPDATE control_tool_calls
       SET status = ?, output_summary = ?, data_json = ?, finished_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ?`,
    )
      .bind(
        "failed",
        result.error.message,
        toJson({
          error: result.error,
          runner,
          relation,
          parentRunId: identity.relation?.parentRunId,
        }),
        timestamp,
        toolCallId,
        identity.scope.userId,
        identity.scope.workspaceId,
      )
      .run();
    await updateToolRunStatus(env, identity, "failed", result.error.message, {
      error: result.error,
      toolName: urlInspectToolName,
      runner,
      relation,
      parentRunId: identity.relation?.parentRunId,
    });
    await appendControlAudit(env, {
      ...identity,
      action: "tool.failed",
      summary: "url.inspect failed.",
      targetType: "toolCall",
      targetId: toolCallId,
      data: { error: result.error, relation },
    });
    await appendControlPlaneEvent(env, identity, {
      type: "tool.failed",
      summary: "url.inspect failed.",
      targetType: "toolCall",
      targetId: toolCallId,
      data: {
        runId: identity.runId,
        error: result.error,
        source: identity.source ?? "admin",
        runner,
        relation,
        parentRunId: identity.relation?.parentRunId,
      },
    });
    return { toolCallId, artifact: null };
  }

  await env.DB.prepare(
    `INSERT INTO control_artifacts (
       id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      artifactId,
      identity.scope.userId,
      identity.scope.workspaceId,
      "report",
      artifactRef.uri,
      artifactRef.title,
      artifactRef.mimeType,
      JSON.stringify(result.output).length,
      toJson({
        output: result.output,
        runner,
        relation,
        parentRunId: identity.relation?.parentRunId,
      }),
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_tool_calls
     SET status = ?, output_summary = ?, artifact_refs_json = ?, data_json = ?, finished_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?`,
  )
    .bind(
      "completed",
      result.output.summary,
      toJson([artifactRef]),
      toJson({ output: result.output, runner }),
      timestamp,
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
    )
    .run();

  await updateToolRunStatus(env, identity, "completed", "URL inspection completed.", {
    artifactIds: [artifactId],
    toolName: urlInspectToolName,
    timingMs: result.output.timingMs,
    runner,
    relation,
    parentRunId: identity.relation?.parentRunId,
  });
  await appendControlAudit(env, {
    ...identity,
    action: "tool.finished",
    summary: "Finished url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
  });
  await appendControlAudit(env, {
    ...identity,
    action: "artifact.created",
    summary: "Created URL inspection artifact metadata.",
    targetType: "artifact",
    targetId: artifactId,
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.finished",
    summary: "Finished url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId: identity.runId,
      artifactId,
      toolName: urlInspectToolName,
      source: identity.source ?? "admin",
      runner,
      relation,
      parentRunId: identity.relation?.parentRunId,
    },
  });

  return { toolCallId, artifact: artifactRef };
};

export const executeUrlInspectRunner = async (
  env: Env,
  runIdentity: ToolRunIdentity,
  url: URL,
  input: {
    executionMode: ExecutionMode;
    policyDecisionId?: string;
    traceId?: string | null;
  },
) => {
  const runner = runIdentity.runner ?? urlInspectRunnerMetadata(env, runIdentity.source ?? "admin");
  const runnerStartedAtMs = Date.now();
  const runnerResult =
    runner.transport === "fly"
      ? await invokeFlyToolRunner(env, runIdentity, {
          scope: runIdentity.scope,
          agentId: runIdentity.agentId,
          runId: runIdentity.runId,
          workflowIntentId: runIdentity.workflowIntentId,
          toolName: urlInspectToolName,
          execution: { mode: input.executionMode, policy: urlInspectPolicy },
          input: { url: url.toString() },
          runner,
          policyDecisionId: input.policyDecisionId,
          source: runIdentity.source ?? "admin",
          traceId: input.traceId,
        })
      : await inspectUrl(url);
  const result = isUrlInspectResult(runnerResult)
    ? runnerResult
    : ({
        ok: false,
        error: urlInspectError(
          "url_inspect_failed",
          "Runner returned an invalid url.inspect response.",
          true,
        ),
      } satisfies UrlInspectResult);
  const runnerEndedAtMs = Date.now();
  const runnerDurationMs = Math.max(0, Math.round(runnerEndedAtMs - runnerStartedAtMs));
  if (input.traceId) {
    await recordSpan(env, runIdentity, {
      traceId: input.traceId,
      name: "Runner dispatch",
      layer: "executor",
      startedAtMs: runnerStartedAtMs,
      endedAtMs: runnerEndedAtMs,
      status: result.ok ? "completed" : "failed",
      data: runnerDispatchTraceData(runner, result, runnerDurationMs),
    });
  }
  const finished = await finishToolRun(env, runIdentity, result);
  return { result, finished };
};

const executeRepoSnapshotRunner = async (
  env: Env,
  runIdentity: ToolRunIdentity,
  snapshotInput: Record<string, unknown>,
  input: {
    executionMode: ExecutionMode;
    policyDecisionId?: string;
    traceId?: string | null;
    callbackUrl: string;
  },
) => {
  const runner = runIdentity.runner ?? repoSnapshotRunnerMetadata(runIdentity.source ?? "admin");
  const runnerStartedAtMs = Date.now();
  const result = await invokeFlyToolRunner(env, runIdentity, {
    scope: runIdentity.scope,
    agentId: runIdentity.agentId,
    runId: runIdentity.runId,
    workflowIntentId: runIdentity.workflowIntentId,
    toolName: repoSnapshotToolName,
    execution: { mode: input.executionMode, policy: repoSnapshotPolicy },
    input: snapshotInput,
    runner,
    callback: {
      url: input.callbackUrl,
      protocolVersion: "workflow-callback-v0",
      traceId: input.traceId,
    },
    policyDecisionId: input.policyDecisionId,
    source: runIdentity.source ?? "admin",
    traceId: input.traceId,
  });
  const runnerEndedAtMs = Date.now();
  const runnerDurationMs = Math.max(0, Math.round(runnerEndedAtMs - runnerStartedAtMs));
  if (input.traceId) {
    await recordSpan(env, runIdentity, {
      traceId: input.traceId,
      name: "Runner dispatch",
      layer: "executor",
      startedAtMs: runnerStartedAtMs,
      endedAtMs: runnerEndedAtMs,
      status: result.ok ? "completed" : "failed",
      data: runnerDispatchTraceData(runner, result, runnerDurationMs),
    });
  }
  const repoResult =
    result.ok && "repoFiles" in result.output
      ? (result as RepoSnapshotResult)
      : !result.ok
        ? (result as RepoSnapshotResult)
        : ({
            ok: false,
            error: repoSnapshotError(
              "repo_snapshot_failed",
              "Runner returned an invalid repo.snapshot response.",
              true,
            ),
          } satisfies RepoSnapshotResult);
  await ensureRepoSnapshotCallbackState(env, runIdentity, repoResult, input.traceId);
  const finished = await readRepoSnapshotFinishedState(env, runIdentity);
  return { result: repoResult, finished };
};

const repoSnapshotArtifactRef = (runId: string, output?: { sizeBytes?: number }) => ({
  id: repoSnapshotArtifactId(runId),
  kind: "report",
  uri: repoSnapshotArtifactUri(runId),
  title: "Repository snapshot report",
  mimeType: "application/json",
  sizeBytes: output?.sizeBytes,
});

const repoSnapshotCallbackData = (
  identity: ToolRunIdentity,
  result: RepoSnapshotResult,
): Record<string, unknown> => {
  const runner = identity.runner ?? repoSnapshotRunnerMetadata(identity.source ?? "admin");
  const relation = relationEventData(identity.relation);
  return {
    runner,
    relation,
    timingMs: result.ok ? result.output.timingMs : undefined,
    commandMetrics: result.ok ? result.output.commandMetrics : undefined,
    fileCounts: result.ok
      ? {
          repoFiles: result.output.repoFiles.length,
          docs: result.output.docs.length,
          configFiles: result.output.configFiles.length,
        }
      : undefined,
    errorCode: result.ok ? undefined : result.error.code,
  };
};

const readRepoSnapshotFinishedState = async (env: Env, identity: ToolRunIdentity) => {
  const [runRow, toolCallRow, artifactRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
              stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
              created_at, updated_at
       FROM control_runs
       WHERE user_id = ? AND workspace_id = ? AND id = ?
       LIMIT 1`,
    )
      .bind(identity.scope.userId, identity.scope.workspaceId, identity.runId)
      .first<ControlRunRow>(),
    env.DB.prepare(
      `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
              input_summary, output_summary, artifact_refs_json, data_json, started_at,
              finished_at, created_at
       FROM control_tool_calls
       WHERE user_id = ? AND workspace_id = ? AND id = ?
       LIMIT 1`,
    )
      .bind(
        identity.scope.userId,
        identity.scope.workspaceId,
        repoSnapshotToolCallId(identity.runId),
      )
      .first<ControlToolCallRow>(),
    env.DB.prepare(
      `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json,
              created_at
       FROM control_artifacts
       WHERE user_id = ? AND workspace_id = ? AND id = ?
       LIMIT 1`,
    )
      .bind(
        identity.scope.userId,
        identity.scope.workspaceId,
        repoSnapshotArtifactId(identity.runId),
      )
      .first<ControlArtifactRow>(),
  ]);

  return {
    runStatus: runRow?.status,
    toolCallId: repoSnapshotToolCallId(identity.runId),
    toolCall: toolCallRow ? toToolCallSummary(toolCallRow) : null,
    artifact: artifactRow ? toArtifactSummary(artifactRow) : null,
  };
};

const ensureRepoSnapshotCallbackState = async (
  env: Env,
  identity: ToolRunIdentity,
  result: RepoSnapshotResult,
  traceId?: string | null,
) => {
  const current = await readRepoSnapshotFinishedState(env, identity);
  if (current.runStatus && terminalRunStatuses.has(current.runStatus)) return;

  const artifactRef = result.ok
    ? repoSnapshotArtifactRef(identity.runId, {
        sizeBytes: JSON.stringify(result.output).length,
      })
    : null;
  const toolCallBase = {
    id: repoSnapshotToolCallId(identity.runId),
    toolId: repoSnapshotToolName,
    data: repoSnapshotCallbackData(identity, result),
  };

  if (result.ok && artifactRef) {
    await applyWorkflowCallbackPayload(env, {
      event: "artifact.created",
      runId: identity.runId,
      workflowIntentId: identity.workflowIntentId,
      summary: "Created repository snapshot artifact metadata.",
      sequence: 2,
      traceId: traceId ?? undefined,
      artifact: {
        ...artifactRef,
        data: repoSnapshotCallbackData(identity, result),
      },
      toolCall: {
        ...toolCallBase,
        status: "running",
        artifactRefs: [artifactRef],
      },
    });
    await applyWorkflowCallbackPayload(env, {
      event: "run.completed",
      runId: identity.runId,
      workflowIntentId: identity.workflowIntentId,
      summary: result.output.summary,
      outputSummary: result.output.summary,
      sequence: 3,
      traceId: traceId ?? undefined,
      output: {
        status: result.output.status,
        summary: result.output.summary,
        packageManager: result.output.packageManager,
        timingMs: result.output.timingMs,
        commandMetrics: result.output.commandMetrics,
        fileCounts: {
          repoFiles: result.output.repoFiles.length,
          docs: result.output.docs.length,
          configFiles: result.output.configFiles.length,
        },
      },
      toolCall: {
        ...toolCallBase,
        status: "completed",
        outputSummary: result.output.summary,
        artifactRefs: [artifactRef],
      },
    });
    return;
  }

  if (!result.ok) {
    await applyWorkflowCallbackPayload(env, {
      event: "run.failed",
      runId: identity.runId,
      workflowIntentId: identity.workflowIntentId,
      summary: result.error.message,
      error: result.error.message,
      sequence: 3,
      traceId: traceId ?? undefined,
      toolCall: {
        ...toolCallBase,
        status: "failed",
        outputSummary: result.error.message,
      },
    });
  }
};

const conformanceToolConfig = (toolName: string) => {
  if (toolName === polymarketMarketSearchToolName) {
    return {
      workflowType: polymarketMarketSearchWorkflowType,
      displayName: "Polymarket market search",
      inputSummary: "Search public Polymarket markets",
      policy: polymarketReadonlyPolicy,
      runner: runnerMetadataFor(polymarketMarketSearchAdapter, "admin"),
      traceKind: "tool.polymarket.market.search" as const,
      traceRootName: "Polymarket market search",
      traceSummary: "Run read-only public Polymarket market search.",
    };
  }
  if (toolName === polymarketMarketSnapshotToolName) {
    return {
      workflowType: polymarketMarketSnapshotWorkflowType,
      displayName: "Polymarket market snapshot",
      inputSummary: "Read public Polymarket market metadata",
      policy: polymarketReadonlyPolicy,
      runner: runnerMetadataFor(polymarketMarketSnapshotAdapter, "admin"),
      traceKind: "tool.polymarket.market.snapshot" as const,
      traceRootName: "Polymarket market snapshot",
      traceSummary: "Run read-only public Polymarket market snapshot.",
    };
  }
  if (toolName === polymarketOrderbookSnapshotToolName) {
    return {
      workflowType: polymarketOrderbookSnapshotWorkflowType,
      displayName: "Polymarket order book snapshot",
      inputSummary: "Read public Polymarket CLOB order book",
      policy: polymarketReadonlyPolicy,
      runner: runnerMetadataFor(polymarketOrderbookSnapshotAdapter, "admin"),
      traceKind: "tool.polymarket.orderbook.snapshot" as const,
      traceRootName: "Polymarket order book snapshot",
      traceSummary: "Run read-only public Polymarket order book snapshot.",
    };
  }
  if (toolName === swordfishRuntimeOverviewToolName) {
    return {
      workflowType: swordfishRuntimeOverviewWorkflowType,
      displayName: "Swordfish runtime overview",
      inputSummary: "Read public Swordfish runtime overview",
      policy: swordfishReadonlyPolicy,
      runner: runnerMetadataFor(swordfishRuntimeOverviewAdapter, "admin"),
      traceKind: "tool.swordfish.runtime.overview" as const,
      traceRootName: "Swordfish runtime overview",
      traceSummary: "Run read-only public Swordfish runtime overview.",
    };
  }
  if (toolName === swordfishSymbolSnapshotToolName) {
    return {
      workflowType: swordfishSymbolSnapshotWorkflowType,
      displayName: "Swordfish symbol snapshot",
      inputSummary: "Read public Swordfish symbol snapshot",
      policy: swordfishReadonlyPolicy,
      runner: runnerMetadataFor(swordfishSymbolSnapshotAdapter, "admin"),
      traceKind: "tool.swordfish.symbol.snapshot" as const,
      traceRootName: "Swordfish symbol snapshot",
      traceSummary: "Run read-only public Swordfish symbol snapshot.",
    };
  }
  if (toolName === swordfishBarsRangeToolName) {
    return {
      workflowType: swordfishBarsRangeWorkflowType,
      displayName: "Swordfish bars range",
      inputSummary: "Read public Swordfish bars range",
      policy: swordfishReadonlyPolicy,
      runner: runnerMetadataFor(swordfishBarsRangeAdapter, "admin"),
      traceKind: "tool.swordfish.bars.range" as const,
      traceRootName: "Swordfish bars range",
      traceSummary: "Run read-only public Swordfish bars range.",
    };
  }
  if (toolName === diagnosticPingToolName) {
    return {
      workflowType: diagnosticPingWorkflowType,
      displayName: "Diagnostic ping",
      inputSummary: "Run deterministic Admin conformance ping",
      policy: diagnosticPingPolicy,
      runner: runnerMetadataFor(diagnosticPingAdapter, "admin"),
      traceKind: "tool.diagnostic.ping" as const,
      traceRootName: "Diagnostic ping",
      traceSummary: "Run Admin conformance ping.",
    };
  }
  if (toolName === runnerEchoToolName) {
    return {
      workflowType: runnerEchoWorkflowType,
      displayName: "Runner echo",
      inputSummary: "Echo bounded input through Fly runner",
      policy: runnerEchoPolicy,
      runner: runnerEchoRunnerMetadata("admin"),
      traceKind: "tool.runner.echo" as const,
      traceRootName: "Runner echo",
      traceSummary: "Run Admin conformance echo through the Fly runner.",
    };
  }
  return {
    workflowType: artifactMetadataTestWorkflowType,
    displayName: "Artifact metadata test",
    inputSummary: "Create metadata-only conformance artifact",
    policy: artifactMetadataTestPolicy,
    runner: runnerMetadataFor(artifactMetadataTestAdapter, "admin"),
    traceKind: "tool.artifact.metadata.test" as const,
    traceRootName: "Artifact metadata test",
    traceSummary: "Run Admin conformance artifact metadata test.",
  };
};

const conformanceToolCallId = (runId: string, toolName: string) =>
  `${runId}-tool-${toolName.replaceAll(".", "-")}`;

const conformanceArtifactId = (runId: string) => `${runId}-artifact-metadata-test`;

const insertConformanceToolRunRecords = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    toolName: string;
    toolInput: Record<string, unknown>;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    traceId?: string | null;
    runner?: ToolRunnerMetadata;
  },
): Promise<ToolRunIdentity> => {
  const config = conformanceToolConfig(input.toolName);
  const timestamp = new Date().toISOString();
  const workflowIntentId = createId("cf-intent");
  const runId = createId("cf-run");
  const toolCallId = conformanceToolCallId(runId, input.toolName);
  const runner = input.runner ?? config.runner;
  const execution = { mode: input.executionMode, policy: config.policy };
  const builtRelation = buildControlRunRelation({ runId });
  if (!builtRelation.ok) throw new Error(builtRelation.reason);
  const relation = builtRelation.relation;
  const relationData = toControlRunRelationEventData(relation);

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
      "observe",
      config.workflowType,
      toJson(execution),
      toJson({ toolName: input.toolName, input: input.toolInput, runner }),
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
      "observe",
      runner.transport === "fly" ? "fly-tool-runner" : "cloudflare-control-plane",
      timestamp,
      timestamp,
      toJson({
        displayName: config.displayName,
        toolName: input.toolName,
        policy: config.policy,
        policyDecisionId: input.policyDecisionId,
        source: "admin",
        runner,
        relation,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, artifact_refs_json, data_json, started_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      workflowIntentId,
      runId,
      input.toolName,
      "running",
      config.inputSummary,
      "[]",
      toJson({
        input: input.toolInput,
        execution,
        source: "admin",
        runner,
        policyDecisionId: input.policyDecisionId,
        relation,
        traceId: input.traceId ?? undefined,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = {
    ...identity,
    runId,
    workflowIntentId,
    source: "admin" as const,
    runner,
    relation,
  };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "intent.created",
    summary: `Created ${input.toolName} workflow intent.`,
    targetType: "workflowIntent",
    targetId: workflowIntentId,
    data: { relation: relationData },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "tool.started",
    summary: `Started ${input.toolName} tool call.`,
    targetType: "toolCall",
    targetId: toolCallId,
    data: { relation: relationData },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.started",
    summary: `Started ${input.toolName} tool call.`,
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId,
      workflowIntentId,
      toolName: input.toolName,
      source: "admin",
      runner,
      relation: relationData,
      traceId: input.traceId ?? undefined,
    },
  });

  return runIdentity;
};

const readConformanceFinishedState = async (
  env: Env,
  identity: ToolRunIdentity,
  toolName: string,
  artifactId?: string | null,
) => {
  const [runRow, toolCallRow, artifactRow] = await Promise.all([
    env.DB.prepare(
      `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
              stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
              created_at, updated_at
       FROM control_runs
       WHERE user_id = ? AND workspace_id = ? AND id = ?
       LIMIT 1`,
    )
      .bind(identity.scope.userId, identity.scope.workspaceId, identity.runId)
      .first<ControlRunRow>(),
    env.DB.prepare(
      `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
              input_summary, output_summary, artifact_refs_json, data_json, started_at,
              finished_at, created_at
       FROM control_tool_calls
       WHERE user_id = ? AND workspace_id = ? AND id = ?
       LIMIT 1`,
    )
      .bind(
        identity.scope.userId,
        identity.scope.workspaceId,
        conformanceToolCallId(identity.runId, toolName),
      )
      .first<ControlToolCallRow>(),
    artifactId
      ? env.DB.prepare(
          `SELECT id, user_id, workspace_id, kind, uri, title, mime_type, size_bytes, data_json,
                  created_at
           FROM control_artifacts
           WHERE user_id = ? AND workspace_id = ? AND id = ?
           LIMIT 1`,
        )
          .bind(identity.scope.userId, identity.scope.workspaceId, artifactId)
          .first<ControlArtifactRow>()
      : Promise.resolve(null),
  ]);

  return {
    runStatus: runRow?.status,
    toolCallId: conformanceToolCallId(identity.runId, toolName),
    toolCall: toolCallRow ? toToolCallSummary(toolCallRow) : null,
    artifact: artifactRow ? toArtifactSummary(artifactRow) : null,
  };
};

const conformanceResultSummary = (result: InlineToolResult) =>
  result.ok ? result.output.summary : result.error.message;

const conformanceResultData = (result: InlineToolResult, runner?: ToolRunnerMetadata) =>
  result.ok ? { output: result.output, runner } : { error: result.error, runner };

const finishInlineConformanceToolRun = async (
  env: Env,
  identity: ToolRunIdentity,
  toolName: string,
  result: InlineToolResult,
  input?: {
    artifact?: {
      id: string;
      kind: string;
      uri: string;
      title: string;
      mimeType: string;
      sizeBytes: number;
      data: Record<string, unknown>;
    } | null;
  },
) => {
  const timestamp = new Date().toISOString();
  const runner = identity.runner;
  const toolCallId = conformanceToolCallId(identity.runId, toolName);
  const artifactRef = input?.artifact
    ? {
        id: input.artifact.id,
        kind: input.artifact.kind,
        uri: input.artifact.uri,
        title: input.artifact.title,
        mimeType: input.artifact.mimeType,
      }
    : null;

  if (input?.artifact) {
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
  }

  await env.DB.prepare(
    `UPDATE control_tool_calls
     SET status = ?, output_summary = ?, artifact_refs_json = ?, data_json = ?, finished_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?`,
  )
    .bind(
      result.ok ? "completed" : "failed",
      conformanceResultSummary(result),
      toJson(artifactRef ? [artifactRef] : []),
      toJson(conformanceResultData(result, runner)),
      timestamp,
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
    )
    .run();

  await updateToolRunStatus(
    env,
    identity,
    result.ok ? "completed" : "failed",
    conformanceResultSummary(result),
    {
      toolName,
      runner,
      artifactIds: artifactRef ? [artifactRef.id] : undefined,
      outputSummary: result.ok ? result.output.summary : undefined,
      error: result.ok ? undefined : result.error,
    },
  );
  await appendControlAudit(env, {
    ...identity,
    action: result.ok ? "tool.finished" : "tool.failed",
    summary: result.ok ? `Finished ${toolName} tool call.` : `${toolName} failed.`,
    targetType: "toolCall",
    targetId: toolCallId,
    data: result.ok ? undefined : { error: result.error },
  });
  if (artifactRef) {
    await appendControlAudit(env, {
      ...identity,
      action: "artifact.created",
      summary: "Created conformance artifact metadata.",
      targetType: "artifact",
      targetId: artifactRef.id,
    });
  }
  await appendControlPlaneEvent(env, identity, {
    type: result.ok ? "tool.finished" : "tool.failed",
    summary: result.ok ? `Finished ${toolName} tool call.` : `${toolName} failed.`,
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId: identity.runId,
      workflowIntentId: identity.workflowIntentId,
      toolName,
      artifactId: artifactRef?.id,
      runner,
      error: result.ok ? undefined : result.error,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName,
      runId: identity.runId,
      workflowIntentId: identity.workflowIntentId,
      toolCallId,
      artifactId: artifactRef?.id ?? null,
      status: result.ok ? "completed" : "failed",
      errorCode: result.ok ? undefined : result.error.code,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "tool-run-updated",
      toolName,
      runId: identity.runId,
    },
  });

  return readConformanceFinishedState(env, identity, toolName, artifactRef?.id);
};

const runDiagnosticPing = (input: { label?: string }): DiagnosticPingResult => {
  const checkedAt = new Date().toISOString();
  return {
    ok: true,
    output: {
      status: "ok",
      summary: input.label
        ? `Diagnostic ping completed: ${input.label}.`
        : "Diagnostic ping completed.",
      label: input.label,
      checkedAt,
    },
  };
};

const runArtifactMetadataTest = (input: { label?: string }): ArtifactMetadataTestResult => ({
  ok: true,
  output: {
    status: "ok",
    summary: input.label
      ? `Artifact metadata test completed: ${input.label}.`
      : "Artifact metadata test completed.",
    label: input.label,
    artifact: {
      kind: "report",
      title: "Artifact metadata test report",
      mimeType: "application/json",
    },
  },
});

const ensureRunnerEchoCallbackState = async (
  env: Env,
  identity: ToolRunIdentity,
  result: RunnerEchoResult,
  traceId?: string | null,
) => {
  const current = await readConformanceFinishedState(env, identity, runnerEchoToolName);
  if (current.runStatus && terminalRunStatuses.has(current.runStatus)) return;
  const runner = identity.runner ?? runnerEchoRunnerMetadata(identity.source ?? "admin");
  const toolCallBase = {
    id: conformanceToolCallId(identity.runId, runnerEchoToolName),
    toolId: runnerEchoToolName,
    data: {
      runner,
      timingMs: result.ok ? result.output.timingMs : undefined,
      length: result.ok ? result.output.length : undefined,
      errorCode: result.ok ? undefined : result.error.code,
    },
  };

  await applyWorkflowCallbackPayload(env, {
    event: result.ok ? "run.completed" : "run.failed",
    runId: identity.runId,
    workflowIntentId: identity.workflowIntentId,
    summary: conformanceResultSummary(result),
    outputSummary: result.ok ? result.output.summary : undefined,
    error: result.ok ? undefined : result.error.message,
    sequence: 2,
    traceId: traceId ?? undefined,
    output: result.ok
      ? {
          status: result.output.status,
          summary: result.output.summary,
          length: result.output.length,
          timingMs: result.output.timingMs,
        }
      : undefined,
    toolCall: {
      ...toolCallBase,
      status: result.ok ? "completed" : "failed",
      outputSummary: conformanceResultSummary(result),
    },
  });
};

const executeRunnerEcho = async (
  env: Env,
  runIdentity: ToolRunIdentity,
  echoInput: Record<string, unknown>,
  input: {
    executionMode: ExecutionMode;
    policyDecisionId: string;
    traceId?: string | null;
    callbackUrl: string;
  },
) => {
  const runner = runIdentity.runner ?? runnerEchoRunnerMetadata(runIdentity.source ?? "admin");
  const runnerStartedAtMs = Date.now();
  const result = await invokeFlyToolRunner(env, runIdentity, {
    scope: runIdentity.scope,
    agentId: runIdentity.agentId,
    runId: runIdentity.runId,
    workflowIntentId: runIdentity.workflowIntentId,
    toolName: runnerEchoToolName,
    execution: { mode: input.executionMode, policy: runnerEchoPolicy },
    input: echoInput,
    runner,
    callback: {
      url: input.callbackUrl,
      protocolVersion: "workflow-callback-v0",
      traceId: input.traceId,
    },
    policyDecisionId: input.policyDecisionId,
    source: runIdentity.source ?? "admin",
    traceId: input.traceId,
  });
  const runnerEndedAtMs = Date.now();
  const runnerDurationMs = Math.max(0, Math.round(runnerEndedAtMs - runnerStartedAtMs));
  if (input.traceId) {
    await recordSpan(env, runIdentity, {
      traceId: input.traceId,
      name: "Runner dispatch",
      layer: "executor",
      startedAtMs: runnerStartedAtMs,
      endedAtMs: runnerEndedAtMs,
      status: result.ok ? "completed" : "failed",
      data: runnerDispatchTraceData(runner, result, runnerDurationMs),
    });
  }
  const echoResult =
    result.ok && "echoed" in result.output
      ? (result as RunnerEchoResult)
      : !result.ok
        ? (result as RunnerEchoResult)
        : ({
            ok: false,
            error: adminTestToolError(
              "test_tool_failed",
              "Runner returned an invalid runner.echo response.",
              true,
            ),
          } satisfies RunnerEchoResult);
  await ensureRunnerEchoCallbackState(env, runIdentity, echoResult, input.traceId);
  const finished = await readConformanceFinishedState(env, runIdentity, runnerEchoToolName);
  return { result: echoResult, finished };
};

const updateToolRunStatus = async (
  env: Env,
  identity: ToolRunIdentity,
  status: "completed" | "failed",
  summary: string,
  data: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, completed_at = ?,
         failed_at = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      status,
      timestamp,
      timestamp,
      status === "completed" ? timestamp : null,
      status === "failed" ? timestamp : null,
      toJson({
        displayName: "URL inspect",
        summary,
        ...data,
      }),
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.runId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ? AND id = ?`,
  )
    .bind(
      status,
      timestamp,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.workflowIntentId,
    )
    .run();
};

const readApprovalRequest = async (env: Env, identity: AgentIdentity, approvalRequestId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            reason, data_json, created_at, updated_at
     FROM control_approval_requests
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?
     LIMIT 1`,
  )
    .bind(approvalRequestId, identity.scope.userId, identity.scope.workspaceId, identity.agentId)
    .first<ControlApprovalRequestRow>();

const updateApprovalStatus = async (
  env: Env,
  approval: ControlApprovalRequestRow,
  status: "approved" | "denied" | "failed",
  data: Record<string, unknown>,
) => {
  const timestamp = new Date().toISOString();
  const existing = parseDataJson(approval.data_json);
  await env.DB.prepare(
    `UPDATE control_approval_requests
     SET status = ?, data_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?`,
  )
    .bind(
      status,
      toJson({
        ...existing,
        ...data,
        decidedAt: timestamp,
      }),
      timestamp,
      approval.id,
      approval.user_id,
      approval.workspace_id,
    )
    .run();
};

const markInterruptedRunRunning = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
) => {
  const timestamp = new Date().toISOString();
  const approvalData = parseDataJson(approval.data_json);
  const runner = isRecord(approvalData.runner)
    ? approvalData.runner
    : urlInspectRunnerMetadata(env, "approval");
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, data_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "running",
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        summary: "Approval granted; URL inspection resumed.",
        toolName: urlInspectToolName,
        approvalRequestId: approval.id,
        runner,
      }),
      timestamp,
      approval.run_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "running",
      timestamp,
      approval.workflow_intent_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();
};

const markInterruptedRunCancelled = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
  summary: string,
) => {
  const timestamp = new Date().toISOString();
  const approvalData = parseDataJson(approval.data_json);
  const runner = isRecord(approvalData.runner)
    ? approvalData.runner
    : urlInspectRunnerMetadata(env, "approval");
  await env.DB.prepare(
    `UPDATE control_runs
     SET status = ?, heartbeat_at = ?, last_event_at = ?, completed_at = ?, data_json = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "cancelled",
      timestamp,
      timestamp,
      timestamp,
      toJson({
        displayName: "URL inspect",
        summary,
        toolName: urlInspectToolName,
        approvalRequestId: approval.id,
        runner,
      }),
      timestamp,
      approval.run_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();

  await env.DB.prepare(
    `UPDATE control_workflow_intents
     SET status = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?`,
  )
    .bind(
      "cancelled",
      timestamp,
      approval.workflow_intent_id,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run();
};

const insertApprovedToolCallRecord = async (
  env: Env,
  identity: AgentIdentity,
  approval: ControlApprovalRequestRow,
  input: {
    url: URL;
    executionMode: ExecutionMode;
    policyDecisionId: string;
    sandboxConstraints?: {
      allowlist?: string[];
      denylist?: string[];
      maxRuntimeMs?: number;
    };
  },
): Promise<ToolRunIdentity> => {
  const timestamp = new Date().toISOString();
  const toolCallId = `${approval.run_id}-tool-url-inspect`;
  const execution = { mode: input.executionMode, policy: urlInspectPolicy };
  const runner = urlInspectRunnerMetadata(env, "approval", input.sandboxConstraints);
  const normalizedInput = { url: input.url.toString() };

  await env.DB.prepare(
    `INSERT INTO control_tool_calls (
       id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
       input_summary, artifact_refs_json, data_json, started_at, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      toolCallId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      approval.workflow_intent_id,
      approval.run_id,
      urlInspectToolName,
      "running",
      `Inspect ${input.url.toString()}`,
      "[]",
      toJson({
        input: normalizedInput,
        execution,
        source: "approval",
        runner,
        resource: urlPolicyResource(input.url),
        approvalRequestId: approval.id,
        policyDecisionId: input.policyDecisionId,
      }),
      timestamp,
      timestamp,
    )
    .run();

  const runIdentity = {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    source: "approval" as const,
    runner,
  };
  await appendControlAudit(env, {
    ...runIdentity,
    action: "run.resumed",
    summary: "Resumed URL inspection after approval.",
    targetType: "run",
    targetId: approval.run_id,
    data: { toolName: urlInspectToolName, approvalRequestId: approval.id, runner },
  });
  await appendControlAudit(env, {
    ...runIdentity,
    action: "tool.started",
    summary: "Started approved url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: { toolName: urlInspectToolName, approvalRequestId: approval.id, runner },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "run.resumed",
    summary: "Resumed URL inspection after approval.",
    targetType: "run",
    targetId: approval.run_id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      approvalRequestId: approval.id,
      runner,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "tool.started",
    summary: "Started approved url.inspect tool call.",
    targetType: "toolCall",
    targetId: toolCallId,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      approvalRequestId: approval.id,
      runner,
    },
  });

  return runIdentity;
};

const approvalRequestBody = (approval: ControlApprovalRequestRow, status?: string) => ({
  id: approval.id,
  status: status ?? approval.status,
  reason: approval.reason,
  humanIntervention: toHumanInterventionSummary(approval, { status }),
  createdAt: approval.created_at,
  updatedAt: approval.updated_at,
});

const approvalListStatuses = new Set(["requested", "decided", "all"]);

const toApprovalDecisionSummary = (data: Record<string, unknown>) => {
  const error = isRecord(data.error) ? data.error : undefined;
  return {
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : undefined,
    decidedByUserId: typeof data.decidedByUserId === "string" ? data.decidedByUserId : undefined,
    denyReason: typeof data.denyReason === "string" ? data.denyReason : undefined,
    policyDecisionId: typeof data.policyDecisionId === "string" ? data.policyDecisionId : undefined,
    error:
      error && (typeof error.code === "string" || typeof error.message === "string")
        ? {
            code: typeof error.code === "string" ? error.code : undefined,
            message: typeof error.message === "string" ? error.message : undefined,
          }
        : undefined,
  };
};

const summarizeApprovalRequest = async (
  env: Env,
  identity: AgentIdentity,
  membership: Awaited<ReturnType<typeof selectMembership>>,
  row: ControlApprovalRequestRow,
) => {
  const data = parseDataJson(row.data_json);
  const input = isRecord(data.input) ? data.input : {};
  const execution = isRecord(data.execution) ? data.execution : {};
  const currentPolicy =
    row.status === "requested"
      ? await evaluateToolPolicy(env, identity, {
          membership,
          toolName: row.tool_id,
          executionMode: "dry_run",
          surface: "admin_resume",
        })
      : null;

  const policySummary = currentPolicy ? toPolicySummary(currentPolicy) : undefined;

  return {
    id: row.id,
    scope: scopeFromRow(row),
    agentId: row.agent_id,
    workflowIntentId: row.workflow_intent_id,
    runId: row.run_id,
    toolId: row.tool_id,
    status: row.status,
    reason: row.reason,
    input:
      typeof input.url === "string"
        ? {
            url: input.url,
          }
        : undefined,
    source: typeof data.source === "string" ? data.source : undefined,
    executionMode: typeof execution.mode === "string" ? execution.mode : undefined,
    policyDecisionId: typeof data.policyDecisionId === "string" ? data.policyDecisionId : undefined,
    decision: toApprovalDecisionSummary(data),
    currentPolicy: policySummary,
    humanIntervention: toHumanInterventionSummary(row, {
      currentPolicy: policySummary
        ? {
            decision: policySummary.decision,
            code: policySummary.code,
            reason: policySummary.reason,
          }
        : undefined,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readApprovalRequestSummary = async (
  env: Env,
  identity: AgentIdentity,
  membership: Awaited<ReturnType<typeof selectMembership>>,
  approvalRequestId: string,
) => {
  const row = await readApprovalRequest(env, identity, approvalRequestId);
  return row ? summarizeApprovalRequest(env, identity, membership, row) : null;
};

const requireActiveAdminMembership = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (membership && membership.status === "active" && isAdminMembership(membership)) {
    return { ok: true as const, membership };
  }
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: urlInspectToolName,
    executionMode: "dry_run",
    surface: "admin_list",
  });
  return {
    ok: false as const,
    membership,
    error: toolError(
      policy.code === "inactive_membership" ? "inactive_membership" : "admin_required",
      policy.code === "inactive_membership"
        ? "Workspace membership is not active."
        : "Workspace owner/admin membership is required to manage tool approvals.",
      false,
    ),
  };
};

const dispatchApprovalUpdated = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    approvalRequestId: string;
    status: string;
    runId?: string;
    workflowIntentId?: string;
    toolName?: string;
    reason?: string;
  },
) => {
  const humanIntervention = toHumanInterventionEventData(input);
  await appendControlPlaneEvent(env, identity, {
    type: "approval.updated",
    summary: input.reason ?? `Approval ${input.status}.`,
    targetType: "approvalRequest",
    targetId: input.approvalRequestId,
    data: {
      approvalRequestId: input.approvalRequestId,
      status: input.status,
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      toolName: input.toolName ?? urlInspectToolName,
      humanIntervention,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "approval.updated",
    data: {
      approvalRequestId: input.approvalRequestId,
      status: input.status,
      runId: input.runId,
      workflowIntentId: input.workflowIntentId,
      toolName: input.toolName ?? urlInspectToolName,
      humanIntervention,
    },
  });
};

export const handleListToolApprovals = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const admin = await requireActiveAdminMembership(env, identity);
  if (!admin.ok) {
    return json(
      {
        ok: false,
        error: admin.error.message,
        details: admin.error,
      },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const requestedStatus = url.searchParams.get("status") ?? "all";
  const status = approvalListStatuses.has(requestedStatus) ? requestedStatus : "all";
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
  const limit = Math.max(1, Math.min(50, Number.isFinite(requestedLimit) ? requestedLimit : 20));
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, run_id, tool_id, status,
            reason, data_json, created_at, updated_at
     FROM control_approval_requests
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ?
       AND (
         ? = 'all'
         OR (? = 'requested' AND status = 'requested')
         OR (? = 'decided' AND status <> 'requested')
       )
     ORDER BY CASE WHEN status = 'requested' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC
     LIMIT ?`,
  )
    .bind(
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      status,
      status,
      status,
      limit,
    )
    .all<ControlApprovalRequestRow>();

  const approvals = await Promise.all(
    rows.results.map((row) => summarizeApprovalRequest(env, identity, admin.membership, row)),
  );

  return json({
    ok: true,
    status,
    approvals,
  });
};

export const handleListTools = async (request: Request, env: Env, identity: AgentIdentity) => {
  const capabilityContext = readDynamicCapabilityContext(new URL(request.url));
  const [toolResolution, latestToolCalls, latestArtifacts] = await Promise.all([
    resolveToolSummaries(env, identity, capabilityContext),
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);

  return json({
    ok: true,
    capabilityContext: toolResolution.context,
    capabilityDecisions: toolResolution.decisions,
    tools: toolResolution.tools,
    latestToolCalls,
    latestArtifacts,
  });
};

const policyUpdateStatuses = new Set<ToolPermissionStatus>(["enabled", "disabled"]);

export const handleUpdateToolPolicy = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const body = parseJson(await request.text());
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  const status = isRecord(body) && typeof body.status === "string" ? body.status : undefined;
  const requiresApproval =
    isRecord(body) && typeof body.requiresApproval === "boolean"
      ? body.requiresApproval
      : undefined;
  const modelVisible =
    isRecord(body) && typeof body.modelVisible === "boolean" ? body.modelVisible : undefined;
  const killSwitchReason =
    isRecord(body) && typeof body.killSwitchReason === "string"
      ? body.killSwitchReason.trim().slice(0, 240)
      : undefined;
  const approvalReason =
    isRecord(body) && typeof body.approvalReason === "string"
      ? body.approvalReason.trim().slice(0, 240)
      : undefined;
  const allowedExecutionModes =
    isRecord(body) && Array.isArray(body.allowedExecutionModes)
      ? body.allowedExecutionModes.filter(
          (mode): mode is "ask" | "dry_run" | "execute" =>
            mode === "ask" || mode === "dry_run" || mode === "execute",
        )
      : undefined;
  const limits = isRecord(body) && isRecord(body.limits) ? body.limits : undefined;
  const cooldownSeconds =
    isRecord(body) && (typeof body.cooldownSeconds === "number" || body.cooldownSeconds === null)
      ? body.cooldownSeconds
      : undefined;
  const maxRuntimeMs =
    isRecord(body) && (typeof body.maxRuntimeMs === "number" || body.maxRuntimeMs === null)
      ? body.maxRuntimeMs
      : undefined;
  const maxArtifactBytes =
    isRecord(body) && (typeof body.maxArtifactBytes === "number" || body.maxArtifactBytes === null)
      ? body.maxArtifactBytes
      : undefined;
  const allowlist =
    isRecord(body) && Array.isArray(body.allowlist)
      ? body.allowlist.filter((item): item is string => typeof item === "string")
      : undefined;
  const denylist =
    isRecord(body) && Array.isArray(body.denylist)
      ? body.denylist.filter((item): item is string => typeof item === "string")
      : undefined;

  if (!isKnownTool(toolName)) {
    return json(
      {
        ok: false,
        error: "Unsupported tool",
        details: toolError(
          "unsupported_tool",
          "Only known tool policy can be updated through this v0 endpoint.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  if (toolName === repoSnapshotToolName && requiresApproval === true) {
    return json(
      {
        ok: false,
        error: "Unsupported policy flag",
        details: toolError(
          "unsupported_policy_flag",
          "repo.snapshot approvals are not supported in this slice.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  if (!isPolicyEditableTool(toolName)) {
    return json(
      {
        ok: false,
        error: "Tool policy is not editable",
        details: toolError(
          "tool_policy_not_editable",
          `${toolName} policy is not editable through this endpoint.`,
          false,
        ),
      },
      { status: 403 },
    );
  }

  if (status !== undefined && !policyUpdateStatuses.has(status as ToolPermissionStatus)) {
    return json(
      {
        ok: false,
        error: "Unsupported policy status",
        details: toolError(
          "unsupported_policy_status",
          "Policy status must be enabled or disabled.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  if (
    status === undefined &&
    requiresApproval === undefined &&
    modelVisible === undefined &&
    killSwitchReason === undefined &&
    approvalReason === undefined &&
    allowedExecutionModes === undefined &&
    limits === undefined &&
    cooldownSeconds === undefined &&
    maxRuntimeMs === undefined &&
    maxArtifactBytes === undefined &&
    allowlist === undefined &&
    denylist === undefined
  ) {
    return json(
      {
        ok: false,
        error: "No policy changes requested",
        details: toolError(
          "invalid_policy_update",
          "Provide at least one supported policy field.",
          false,
        ),
      },
      { status: 400 },
    );
  }

  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (!membership || membership.status !== "active" || !isAdminMembership(membership)) {
    const policy = await evaluateToolPolicy(env, identity, {
      membership,
      toolName,
      executionMode: "dry_run",
      surface: "admin_list",
    });
    const decisionId = await recordToolPolicyDecision(env, identity, {
      toolName,
      surface: "admin_list",
      result: policy,
      data: {
        action: "tool.policy.update",
        requestedStatus: status,
        requestedRequiresApproval: requiresApproval,
        requestedModelVisible: modelVisible,
        requestedLimits: limits,
      },
    });
    return json(
      {
        ok: false,
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId: decisionId,
      },
      { status: policy.status },
    );
  }

  const permission = await updateToolPermissionStatus(env, identity, {
    toolName,
    status: status as ToolPermissionStatus | undefined,
    requiresApproval,
    killSwitchReason,
    modelVisible,
    approvalReason,
    allowedExecutionModes,
    limits,
    cooldownSeconds,
    maxRuntimeMs,
    maxArtifactBytes,
    allowlist,
    denylist,
  });
  const toolResolution = await resolveToolSummaries(env, identity);
  const tool = toolResolution.tools.find((item) => item.name === toolName);
  await appendControlPlaneEvent(env, identity, {
    type: "tool.policy.updated",
    summary: `${toolName} policy updated.`,
    targetType: "toolPermission",
    targetId: permission?.id,
    data: {
      toolName,
      status: permission?.status,
      requiresApproval,
      modelVisible,
      killSwitchReason,
      approvalReason,
      limits,
      cooldownSeconds,
      maxRuntimeMs,
      maxArtifactBytes,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "tool-policy-updated",
      toolName,
      status: permission?.status,
    },
  });

  return json({
    ok: true,
    toolName,
    status: permission?.status,
    requiresApproval: tool?.approvalRequired,
    modelVisible: tool?.modelVisible,
    policyConstraints: tool?.policyConstraints,
    permissionId: permission?.id,
    tool,
  });
};

const finishToolTrace = async (
  env: Env,
  identity: AgentIdentity,
  trace: RuntimeTraceContext | null,
  input: Parameters<typeof finishTrace>[3],
) => {
  if (!trace) return;
  await finishTrace(env, identity, trace, input);
};

const requireAdminToolPolicy = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  if (membership && membership.status === "active" && isAdminMembership(membership)) {
    return { ok: true as const, membership };
  }
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: urlInspectToolName,
    executionMode: "dry_run",
    surface: "admin_list",
  });
  const decisionId = await recordToolPolicyDecision(env, identity, {
    toolName: urlInspectToolName,
    surface: "admin_list",
    result: policy,
    data: { action: "tool.approval.manage" },
  });
  return { ok: false as const, policy, decisionId };
};

export const handleApproveToolApproval = async (
  env: Env,
  identity: AgentIdentity,
  approvalRequestId: string,
) => {
  if (!approvalRequestId) {
    return json(
      {
        ok: false,
        error: "Approval request id is required",
        details: toolError("invalid_approval_request", "Approval request id is required.", false),
      },
      { status: 400 },
    );
  }

  const admin = await requireAdminToolPolicy(env, identity);
  if (!admin.ok) {
    return json(
      {
        ok: false,
        error: admin.policy.reason,
        details: toolPolicyError(admin.policy),
        policyDecisionId: admin.decisionId,
      },
      { status: admin.policy.status },
    );
  }

  const approval = await readApprovalRequest(env, identity, approvalRequestId);
  if (!approval) {
    return json(
      {
        ok: false,
        error: "Approval request not found",
        details: toolError(
          "approval_not_found",
          "Approval request was not found in this workspace scope.",
          false,
        ),
      },
      { status: 404 },
    );
  }
  if (approval.status !== "requested") {
    return json(
      {
        ok: false,
        error: "Approval request is already decided",
        approvalRequest: approvalRequestBody(approval),
        details: toolError(
          "approval_already_decided",
          "Only requested approvals can be approved.",
          false,
        ),
      },
      { status: 409 },
    );
  }

  const approvalData = parseDataJson(approval.data_json);
  const originalInput = isRecord(approvalData.input) ? approvalData.input : undefined;
  const validated = validateUrlInspectInput(originalInput);
  if (!validated.ok) {
    await updateApprovalStatus(env, approval, "failed", {
      decidedByUserId: identity.scope.userId,
      error: validated.error,
    });
    await markInterruptedRunCancelled(env, identity, approval, validated.error.message);
    await dispatchApprovalUpdated(env, identity, {
      approvalRequestId: approval.id,
      status: "failed",
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: approval.tool_id,
      reason: validated.error.message,
    });
    const failedApproval = await readApprovalRequestSummary(
      env,
      identity,
      admin.membership,
      approval.id,
    );
    return json(
      {
        ok: false,
        error: validated.error.message,
        approvalRequest: failedApproval ?? approvalRequestBody(approval, "failed"),
        details: validated.error,
      },
      { status: validated.status },
    );
  }

  const policy = await evaluateToolPolicy(env, identity, {
    membership: admin.membership,
    toolName: approval.tool_id,
    executionMode: "dry_run",
    surface: "admin_resume",
    resource: urlPolicyResource(validated.url),
  });
  const policyDecisionId = await recordToolPolicyDecision(env, identity, {
    toolName: approval.tool_id,
    surface: "admin_resume",
    result: policy,
    data: { action: "approval.approve", approvalRequestId: approval.id },
  });
  if (policy.decision === "block") {
    return json(
      {
        ok: false,
        error: policy.reason,
        approvalRequest: approvalRequestBody(approval),
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  await updateApprovalStatus(env, approval, "approved", {
    decidedByUserId: identity.scope.userId,
    policyDecisionId,
  });
  await markInterruptedRunRunning(env, identity, approval);
  await appendControlAudit(env, {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    action: "approval.approved",
    summary: "Approved url.inspect execution.",
    targetType: "approvalRequest",
    targetId: approval.id,
    data: { toolName: urlInspectToolName, policyDecisionId },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "approval.approved",
    summary: "Approved url.inspect execution.",
    targetType: "approvalRequest",
    targetId: approval.id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      policyDecisionId,
    },
  });
  await dispatchApprovalUpdated(env, identity, {
    approvalRequestId: approval.id,
    status: "approved",
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    toolName: approval.tool_id,
    reason: "Approved url.inspect execution.",
  });

  const runIdentity = await insertApprovedToolCallRecord(env, identity, approval, {
    url: validated.url,
    executionMode: policy.executionMode,
    policyDecisionId,
    sandboxConstraints: policy.constraints,
  });
  const { result, finished } = await executeUrlInspectRunner(env, runIdentity, validated.url, {
    executionMode: policy.executionMode,
    policyDecisionId,
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName: urlInspectToolName,
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolCallId: finished.toolCallId,
      artifactId: finished.artifact?.id ?? null,
      approvalRequestId: approval.id,
      status: result.ok ? "completed" : "failed",
      errorCode: result.ok ? undefined : result.error.code,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "approval-approved",
      toolName: urlInspectToolName,
      runId: approval.run_id,
    },
  });

  const [latestToolCalls, latestArtifacts] = await Promise.all([
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);
  const toolCall = latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
  const artifact = finished.artifact
    ? (latestArtifacts.find((item) => item.id === finished.artifact?.id) ?? finished.artifact)
    : null;
  const approvedApproval = await readApprovalRequestSummary(
    env,
    identity,
    admin.membership,
    approval.id,
  );

  return json(
    {
      ok: result.ok,
      run: {
        id: approval.run_id,
        workflowIntentId: approval.workflow_intent_id,
        status: result.ok ? "completed" : "failed",
        execution: { mode: policy.executionMode, policy: urlInspectPolicy },
        policyDecisionId,
      },
      approvalRequest: approvedApproval ?? approvalRequestBody(approval, "approved"),
      toolCall,
      artifact,
      error: result.ok ? undefined : result.error,
      policyDecisionId,
    },
    { status: result.ok ? 200 : 502 },
  );
};

export const handleDenyToolApproval = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  approvalRequestId: string,
) => {
  if (!approvalRequestId) {
    return json(
      {
        ok: false,
        error: "Approval request id is required",
        details: toolError("invalid_approval_request", "Approval request id is required.", false),
      },
      { status: 400 },
    );
  }

  const admin = await requireAdminToolPolicy(env, identity);
  if (!admin.ok) {
    return json(
      {
        ok: false,
        error: admin.policy.reason,
        details: toolPolicyError(admin.policy),
        policyDecisionId: admin.decisionId,
      },
      { status: admin.policy.status },
    );
  }

  const approval = await readApprovalRequest(env, identity, approvalRequestId);
  if (!approval) {
    return json(
      {
        ok: false,
        error: "Approval request not found",
        details: toolError(
          "approval_not_found",
          "Approval request was not found in this workspace scope.",
          false,
        ),
      },
      { status: 404 },
    );
  }
  if (approval.status !== "requested") {
    return json(
      {
        ok: false,
        error: "Approval request is already decided",
        approvalRequest: approvalRequestBody(approval),
        details: toolError(
          "approval_already_decided",
          "Only requested approvals can be denied.",
          false,
        ),
      },
      { status: 409 },
    );
  }

  const body = parseJson(await request.text());
  const denyReason =
    isRecord(body) && typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 240)
      : "Approval denied by workspace admin.";
  await updateApprovalStatus(env, approval, "denied", {
    decidedByUserId: identity.scope.userId,
    denyReason,
  });
  await markInterruptedRunCancelled(env, identity, approval, denyReason);
  await appendControlAudit(env, {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    action: "approval.denied",
    summary: denyReason,
    targetType: "approvalRequest",
    targetId: approval.id,
    data: { toolName: urlInspectToolName },
  });
  await appendControlAudit(env, {
    ...identity,
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    action: "run.cancelled",
    summary: denyReason,
    targetType: "run",
    targetId: approval.run_id,
    data: { toolName: urlInspectToolName, approvalRequestId: approval.id },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "approval.denied",
    summary: denyReason,
    targetType: "approvalRequest",
    targetId: approval.id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "run.cancelled",
    summary: denyReason,
    targetType: "run",
    targetId: approval.run_id,
    data: {
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      toolName: urlInspectToolName,
      approvalRequestId: approval.id,
    },
  });
  await dispatchApprovalUpdated(env, identity, {
    approvalRequestId: approval.id,
    status: "denied",
    runId: approval.run_id,
    workflowIntentId: approval.workflow_intent_id,
    toolName: approval.tool_id,
    reason: denyReason,
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName: urlInspectToolName,
      runId: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      approvalRequestId: approval.id,
      status: "cancelled",
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "approval-denied",
      toolName: urlInspectToolName,
      runId: approval.run_id,
    },
  });
  const deniedApproval = await readApprovalRequestSummary(
    env,
    identity,
    admin.membership,
    approval.id,
  );

  return json({
    ok: true,
    run: {
      id: approval.run_id,
      workflowIntentId: approval.workflow_intent_id,
      status: "cancelled",
      execution: { mode: "dry_run", policy: urlInspectPolicy },
    },
    approvalRequest: deniedApproval ?? approvalRequestBody(approval, "denied"),
    toolCall: null,
    artifact: null,
  });
};

const handleRunRepoSnapshot = async (
  request: Request,
  body: unknown,
  env: Env,
  identity: AgentIdentity,
  incomingTrace?: IncomingRuntimeTrace,
) => {
  const trace = await startTrace(env, identity, {
    traceId: incomingTrace?.traceId,
    kind: "tool.repo.snapshot",
    rootName: "Repository snapshot",
    summary: "Run Admin-triggered read-only repository snapshot.",
    startedAtMs: incomingTrace?.authzStartedAtMs,
    data: { toolName: repoSnapshotToolName },
  });
  await recordIncomingRequestSpans(env, identity, trace, incomingTrace);

  const executionMode =
    isRecord(body) && typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  const policyStartedAtMs = Date.now();
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName: repoSnapshotToolName,
    executionMode,
    surface: "admin_run",
  });
  const policyDecisionId = await recordToolPolicyDecision(env, identity, {
    toolName: repoSnapshotToolName,
    surface: "admin_run",
    result: policy,
    data: { requestedToolName: repoSnapshotToolName },
  });
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Tool policy check",
    layer: "cloudflare",
    startedAtMs: policyStartedAtMs,
    status: policy.decision === "allow" ? "completed" : "blocked",
    data: {
      role: membership?.role ?? null,
      toolName: repoSnapshotToolName,
      code: policy.code,
      policyDecisionId,
    },
  });

  if (policy.decision === "block") {
    await finishToolTrace(env, identity, trace, {
      status: "blocked",
      summary: policy.reason,
      data: { errorCode: policy.code, policyDecisionId },
    });
    return json(
      {
        ok: false,
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  const parsedInput = validateRepoSnapshotInput(isRecord(body) ? body.input : undefined);
  if ("code" in parsedInput) {
    await finishToolTrace(env, identity, trace, {
      status: "failed",
      summary: parsedInput.message,
      data: { error: parsedInput },
    });
    return json(
      {
        ok: false,
        error: parsedInput.message,
        details: parsedInput,
      },
      { status: 400 },
    );
  }

  const recordsStartedAtMs = Date.now();
  const runIdentity = await insertRepoSnapshotRunRecords(env, identity, {
    snapshotInput: parsedInput,
    executionMode: policy.executionMode,
    policyDecisionId,
    traceId: trace.traceId,
    sandboxConstraints: policy.constraints,
  });
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Run queued and tool-call record write",
    layer: "d1",
    startedAtMs: recordsStartedAtMs,
    data: { runId: runIdentity.runId, workflowIntentId: runIdentity.workflowIntentId },
  });

  const executionStartedAtMs = Date.now();
  const { result, finished } = await executeRepoSnapshotRunner(env, runIdentity, parsedInput, {
    executionMode: policy.executionMode,
    policyDecisionId,
    traceId: trace.traceId,
    callbackUrl: `${new URL(request.url).origin}/workbench/run-callbacks`,
  });
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Callback lifecycle readback",
    layer: "d1",
    startedAtMs: executionStartedAtMs,
    status: result.ok ? "completed" : "failed",
    data: {
      runId: runIdentity.runId,
      toolCallId: finished.toolCallId,
      artifactId: finished.artifact?.id ?? null,
    },
  });
  await finishToolTrace(env, identity, trace, {
    status: result.ok ? "completed" : "failed",
    summary: result.ok ? result.output.summary : result.error.message,
    data: {
      runId: runIdentity.runId,
      workflowIntentId: runIdentity.workflowIntentId,
      toolCallId: finished.toolCallId,
      artifactId: finished.artifact?.id ?? null,
      toolName: repoSnapshotToolName,
      error: result.ok ? undefined : result.error,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "trace.updated",
    data: {
      traceId: trace.traceId,
      kind: trace.kind,
      status: result.ok ? "completed" : "failed",
      runId: runIdentity.runId,
    },
  });

  const [latestToolCalls, latestArtifacts] = await Promise.all([
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);
  const toolCall =
    finished.toolCall ?? latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
  const artifact = finished.artifact
    ? (latestArtifacts.find((item) => item.id === finished.artifact?.id) ?? finished.artifact)
    : null;

  return json(
    {
      ok: result.ok,
      run: {
        id: runIdentity.runId,
        workflowIntentId: runIdentity.workflowIntentId,
        status: finished.runStatus ?? (result.ok ? "completed" : "failed"),
        execution: { mode: policy.executionMode, policy: repoSnapshotPolicy },
        policyDecisionId,
        relation: relationEventData(runIdentity.relation),
      },
      toolCall,
      artifact,
      error: result.ok ? undefined : result.error,
      policyDecisionId,
    },
    { status: result.ok ? 201 : 502 },
  );
};

const handleRunConformanceTool = async (
  request: Request,
  body: unknown,
  env: Env,
  identity: AgentIdentity,
  toolName: string,
  incomingTrace?: IncomingRuntimeTrace,
) => {
  const config = conformanceToolConfig(toolName);
  const trace = await startTrace(env, identity, {
    traceId: incomingTrace?.traceId,
    kind: config.traceKind,
    rootName: config.traceRootName,
    summary: config.traceSummary,
    startedAtMs: incomingTrace?.authzStartedAtMs,
    data: { toolName },
  });
  await recordIncomingRequestSpans(env, identity, trace, incomingTrace);

  const executionMode =
    isRecord(body) && typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  const policyStartedAtMs = Date.now();
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName,
    executionMode,
    surface: "admin_run",
  });
  const policyDecisionId = await recordToolPolicyDecision(env, identity, {
    toolName,
    surface: "admin_run",
    result: policy,
    data: { requestedToolName: toolName },
  });
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Tool policy check",
    layer: "cloudflare",
    startedAtMs: policyStartedAtMs,
    status: policy.decision === "allow" ? "completed" : "blocked",
    data: {
      role: membership?.role ?? null,
      toolName,
      code: policy.code,
      policyDecisionId,
    },
  });

  if (policy.decision === "block") {
    await finishToolTrace(env, identity, trace, {
      status: "blocked",
      summary: policy.reason,
      data: { errorCode: policy.code, policyDecisionId },
    });
    return json(
      {
        ok: false,
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  const rawInput = isRecord(body) ? body.input : undefined;
  const parsedInput =
    toolName === diagnosticPingToolName
      ? validateDiagnosticPingInput(rawInput)
      : toolName === runnerEchoToolName
        ? validateRunnerEchoInput(rawInput)
        : toolName === artifactMetadataTestToolName
          ? validateArtifactMetadataTestInput(rawInput)
          : toolName === polymarketMarketSearchToolName
            ? validatePolymarketMarketSearchInput(rawInput)
            : toolName === polymarketMarketSnapshotToolName
              ? validatePolymarketMarketSnapshotInput(rawInput)
              : toolName === polymarketOrderbookSnapshotToolName
                ? validatePolymarketOrderbookSnapshotInput(rawInput)
                : toolName === swordfishRuntimeOverviewToolName
                  ? validateSwordfishRuntimeOverviewInput(rawInput)
                  : toolName === swordfishSymbolSnapshotToolName
                    ? validateSwordfishSymbolSnapshotInput(rawInput)
                    : validateSwordfishBarsRangeInput(rawInput);
  if ("code" in parsedInput) {
    await finishToolTrace(env, identity, trace, {
      status: "failed",
      summary: parsedInput.message,
      data: { error: parsedInput },
    });
    return json(
      {
        ok: false,
        error: parsedInput.message,
        details: parsedInput,
      },
      { status: 400 },
    );
  }

  const runner =
    toolName === runnerEchoToolName
      ? runnerEchoRunnerMetadata("admin", policy.constraints)
      : config.runner;
  const recordsStartedAtMs = Date.now();
  const runIdentity = await insertConformanceToolRunRecords(env, identity, {
    toolName,
    toolInput: parsedInput,
    executionMode: policy.executionMode,
    policyDecisionId,
    traceId: trace.traceId,
    runner,
  });
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Run queued and tool-call record write",
    layer: "d1",
    startedAtMs: recordsStartedAtMs,
    data: { runId: runIdentity.runId, workflowIntentId: runIdentity.workflowIntentId },
  });

  const executionStartedAtMs = Date.now();
  const execution =
    toolName === diagnosticPingToolName
      ? await (async () => {
          const pingInput = parsedInput as { label?: string };
          const result = runDiagnosticPing(pingInput);
          return {
            result,
            finished: await finishInlineConformanceToolRun(env, runIdentity, toolName, result),
          };
        })()
      : toolName === artifactMetadataTestToolName
        ? await (async () => {
            const artifactInput = parsedInput as { label?: string };
            const result = runArtifactMetadataTest(artifactInput);
            const artifactId = conformanceArtifactId(runIdentity.runId);
            const artifactData = {
              source: "admin_conformance",
              toolName,
              label: artifactInput.label,
              runner,
              outputSummary: result.ok ? result.output.summary : undefined,
            };
            const artifact = {
              id: artifactId,
              kind: "report",
              uri: `d1://control-plane/${runIdentity.runId}/artifact-metadata-test.json`,
              title: "Artifact metadata test report",
              mimeType: "application/json",
              sizeBytes: JSON.stringify(artifactData).length,
              data: artifactData,
            };
            return {
              result,
              finished: await finishInlineConformanceToolRun(env, runIdentity, toolName, result, {
                artifact,
              }),
            };
          })()
        : isPolymarketReadonlyToolName(toolName)
          ? await (async () => {
              const result = await runPolymarketReadonlyTool(
                toolName,
                parsedInput as Parameters<typeof runPolymarketReadonlyTool>[1],
              );
              const artifactData = result.ok
                ? {
                    source: "polymarket_public_readonly",
                    toolName,
                    output: result.output,
                    runner,
                  }
                : {
                    source: "polymarket_public_readonly",
                    toolName,
                    error: result.error,
                    runner,
                  };
              const artifact = result.ok
                ? {
                    id: `${runIdentity.runId}-polymarket-readonly`,
                    kind: "market_data",
                    uri: `d1://control-plane/${runIdentity.runId}/${toolName.replaceAll(
                      ".",
                      "-",
                    )}.json`,
                    title: config.displayName,
                    mimeType: "application/json",
                    sizeBytes: JSON.stringify(artifactData).length,
                    data: artifactData,
                  }
                : null;
              return {
                result,
                finished: await finishInlineConformanceToolRun(env, runIdentity, toolName, result, {
                  artifact,
                }),
              };
            })()
          : isSwordfishReadonlyToolName(toolName)
            ? await (async () => {
                const result = await runSwordfishReadonlyTool(
                  toolName,
                  parsedInput as Parameters<typeof runSwordfishReadonlyTool>[1],
                );
                const artifactData = result.ok
                  ? {
                      source: "swordfish_public_readonly",
                      toolName,
                      output: result.output,
                      runner,
                    }
                  : {
                      source: "swordfish_public_readonly",
                      toolName,
                      error: result.error,
                      runner,
                    };
                const artifact = result.ok
                  ? {
                      id: `${runIdentity.runId}-swordfish-readonly`,
                      kind: "market_data",
                      uri: `d1://control-plane/${runIdentity.runId}/${toolName.replaceAll(
                        ".",
                        "-",
                      )}.json`,
                      title: config.displayName,
                      mimeType: "application/json",
                      sizeBytes: JSON.stringify(artifactData).length,
                      data: artifactData,
                    }
                  : null;
                return {
                  result,
                  finished: await finishInlineConformanceToolRun(
                    env,
                    runIdentity,
                    toolName,
                    result,
                    {
                      artifact,
                    },
                  ),
                };
              })()
            : await executeRunnerEcho(env, runIdentity, parsedInput as Record<string, unknown>, {
                executionMode: policy.executionMode,
                policyDecisionId,
                traceId: trace.traceId,
                callbackUrl: `${new URL(request.url).origin}/workbench/run-callbacks`,
              });

  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: toolName === runnerEchoToolName ? "Callback lifecycle readback" : "Tool completion write",
    layer: "d1",
    startedAtMs: executionStartedAtMs,
    status: execution.result.ok ? "completed" : "failed",
    data: {
      runId: runIdentity.runId,
      toolCallId: execution.finished.toolCallId,
      artifactId: execution.finished.artifact?.id ?? null,
    },
  });
  await finishToolTrace(env, identity, trace, {
    status: execution.result.ok ? "completed" : "failed",
    summary: conformanceResultSummary(execution.result),
    data: {
      runId: runIdentity.runId,
      workflowIntentId: runIdentity.workflowIntentId,
      toolCallId: execution.finished.toolCallId,
      artifactId: execution.finished.artifact?.id ?? null,
      toolName,
      error: execution.result.ok ? undefined : execution.result.error,
    },
  });
  if (toolName === runnerEchoToolName) {
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "trace.updated",
      data: {
        traceId: trace.traceId,
        kind: trace.kind,
        status: execution.result.ok ? "completed" : "failed",
        runId: runIdentity.runId,
      },
    });
  }

  return json(
    {
      ok: execution.result.ok,
      run: {
        id: runIdentity.runId,
        workflowIntentId: runIdentity.workflowIntentId,
        status: execution.finished.runStatus ?? (execution.result.ok ? "completed" : "failed"),
        execution: { mode: policy.executionMode, policy: config.policy },
        policyDecisionId,
        relation: relationEventData(runIdentity.relation),
      },
      toolCall: execution.finished.toolCall,
      artifact: execution.finished.artifact,
      error: execution.result.ok ? undefined : execution.result.error,
      policyDecisionId,
    },
    { status: execution.result.ok ? 201 : 502 },
  );
};

export const handleRunTool = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  incomingTrace?: IncomingRuntimeTrace,
) => {
  const bodyText = await request.text();
  const body = parseJson(bodyText);
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  if (toolName === repoSnapshotToolName) {
    return handleRunRepoSnapshot(request, body, env, identity, incomingTrace);
  }
  if (
    toolName === diagnosticPingToolName ||
    toolName === runnerEchoToolName ||
    toolName === artifactMetadataTestToolName ||
    isPolymarketReadonlyToolName(toolName)
  ) {
    return handleRunConformanceTool(request, body, env, identity, toolName, incomingTrace);
  }
  const trace =
    toolName === urlInspectToolName
      ? await startTrace(env, identity, {
          traceId: incomingTrace?.traceId,
          kind: "tool.url.inspect",
          rootName: "URL inspect",
          summary: "Run Admin-triggered read-only URL inspection.",
          startedAtMs: incomingTrace?.authzStartedAtMs,
          data: { toolName: urlInspectToolName },
        })
      : null;
  if (trace) await recordIncomingRequestSpans(env, identity, trace, incomingTrace);

  const executionMode =
    isRecord(body) && typeof body.executionMode === "string" ? body.executionMode : "dry_run";
  const policyStartedAtMs = Date.now();
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  const policy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName,
    executionMode,
    surface: "admin_run",
  });
  const policyDecisionId = await recordToolPolicyDecision(env, identity, {
    toolName,
    surface: "admin_run",
    result: policy,
    data: { requestedToolName: toolName },
  });
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Tool policy check",
      layer: "cloudflare",
      startedAtMs: policyStartedAtMs,
      status: policy.decision === "allow" ? "completed" : "blocked",
      data: {
        role: membership?.role ?? null,
        toolName,
        code: policy.code,
        policyDecisionId,
      },
    });
  }

  if (policy.decision === "block" && policy.code !== "approval_required") {
    if (trace) {
      await finishToolTrace(env, identity, trace, {
        status: "blocked",
        summary: policy.reason,
        data: { errorCode: policy.code, policyDecisionId },
      });
    }
    return json(
      {
        ok: false,
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  const input = isRecord(body) ? body.input : undefined;
  const validated = validateUrlInspectInput(input);
  if (!validated.ok) {
    if (trace) {
      await recordSpan(env, identity, {
        traceId: trace.traceId,
        name: "Input validation",
        layer: "cloudflare",
        startedAtMs: Date.now(),
        status: validated.status === 403 ? "blocked" : "failed",
        data: { code: validated.error.code, url: isRecord(input) ? input.url : undefined },
      });
      await finishToolTrace(env, identity, trace, {
        status: validated.status === 403 ? "blocked" : "failed",
        summary: validated.error.message,
        data: { error: validated.error },
      });
    }
    return json(
      {
        ok: false,
        error: validated.error.message,
        details: validated.error,
      },
      { status: validated.status },
    );
  }

  const resourcePolicy = await evaluateToolPolicy(env, identity, {
    membership,
    toolName,
    executionMode,
    surface: "admin_run",
    resource: urlPolicyResource(validated.url),
  });
  if (resourcePolicy.decision === "block" && resourcePolicy.code !== "approval_required") {
    const resourcePolicyDecisionId = await recordToolPolicyDecision(env, identity, {
      toolName,
      surface: "admin_run",
      result: resourcePolicy,
      data: {
        requestedToolName: toolName,
        resource: urlPolicyResource(validated.url),
      },
    });
    if (trace) {
      await finishToolTrace(env, identity, trace, {
        status: "blocked",
        summary: resourcePolicy.reason,
        data: { errorCode: resourcePolicy.code, policyDecisionId: resourcePolicyDecisionId },
      });
    }
    return json(
      {
        ok: false,
        error: resourcePolicy.reason,
        details: toolPolicyError(resourcePolicy),
        policyDecisionId: resourcePolicyDecisionId,
      },
      { status: resourcePolicy.status },
    );
  }

  const requestedParentRunId =
    isRecord(body) && typeof body.parentRunId === "string" && body.parentRunId.trim()
      ? body.parentRunId.trim()
      : "";
  let parentRun: ControlRunRelationParent | null = null;
  if (requestedParentRunId) {
    parentRun = await readParentControlRun(env, identity, requestedParentRunId);
    if (!parentRun) {
      const details = {
        code: "parent_run_not_found",
        message: "Parent run was not found in this workspace.",
        retryable: false,
        redacted: true,
      };
      if (trace) {
        await finishToolTrace(env, identity, trace, {
          status: "blocked",
          summary: details.message,
          data: { error: details, parentRunId: requestedParentRunId, policyDecisionId },
        });
      }
      return json(
        { ok: false, error: details.message, details, policyDecisionId },
        { status: 404 },
      );
    }

    const parentRelation = readControlRunRelation(parentRun.data, parentRun.id);
    const nextDepth = (parentRelation?.depth ?? 0) + 1;
    if (nextDepth > 1) {
      const details = {
        code: "child_run_depth_exceeded",
        message: "Child run depth exceeds the configured max depth of 1.",
        retryable: false,
        redacted: true,
      };
      if (trace) {
        await finishToolTrace(env, identity, trace, {
          status: "blocked",
          summary: details.message,
          data: { error: details, parentRunId: requestedParentRunId, policyDecisionId },
        });
      }
      await appendControlPlaneEvent(env, identity, {
        type: "run.child.blocked",
        summary: details.message,
        targetType: "run",
        targetId: requestedParentRunId,
        data: {
          parentRunId: requestedParentRunId,
          reason: details.code,
          maxDepth: 1,
          nextDepth,
        },
      });
      return json(
        { ok: false, error: details.message, details, policyDecisionId },
        { status: 403 },
      );
    }
  }

  if (policy.code === "approval_required") {
    const approvalStartedAtMs = Date.now();
    const interrupted = await insertApprovalInterruptedRun(env, identity, {
      url: validated.url,
      executionMode: policy.executionMode,
      policyDecisionId,
      reason: policy.reason,
      sandboxConstraints: policy.constraints,
    });
    if (trace) {
      await recordSpan(env, identity, {
        traceId: trace.traceId,
        name: "Approval request recorded",
        layer: "d1",
        startedAtMs: approvalStartedAtMs,
        status: "blocked",
        data: {
          runId: interrupted.runId,
          workflowIntentId: interrupted.workflowIntentId,
          approvalRequestId: interrupted.approvalRequestId,
        },
      });
      await finishToolTrace(env, identity, trace, {
        status: "blocked",
        summary: policy.reason,
        data: {
          runId: interrupted.runId,
          workflowIntentId: interrupted.workflowIntentId,
          approvalRequestId: interrupted.approvalRequestId,
          policyDecisionId,
          errorCode: policy.code,
        },
      });
    }
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "tool.run.updated",
      data: {
        toolName: urlInspectToolName,
        runId: interrupted.runId,
        workflowIntentId: interrupted.workflowIntentId,
        approvalRequestId: interrupted.approvalRequestId,
        status: "interrupted",
        traceId: trace?.traceId,
        errorCode: policy.code,
      },
    });
    await dispatchApprovalUpdated(env, identity, {
      approvalRequestId: interrupted.approvalRequestId,
      status: "requested",
      runId: interrupted.runId,
      workflowIntentId: interrupted.workflowIntentId,
      toolName: urlInspectToolName,
      reason: policy.reason,
    });
    if (trace) {
      await dispatchWorkbenchSessionEvent(env, identity, {
        type: "trace.updated",
        data: {
          traceId: trace.traceId,
          kind: trace.kind,
          status: "blocked",
          runId: interrupted.runId,
        },
      });
    }
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "admin.summary.invalidated",
      data: {
        reason: "approval-requested",
        toolName: urlInspectToolName,
        runId: interrupted.runId,
        traceId: trace?.traceId,
      },
    });
    return json(
      {
        ok: false,
        run: {
          id: interrupted.runId,
          workflowIntentId: interrupted.workflowIntentId,
          status: "interrupted",
          execution: { mode: policy.executionMode, policy: urlInspectPolicy },
          policyDecisionId,
        },
        approvalRequest: {
          id: interrupted.approvalRequestId,
          status: "requested",
          reason: policy.reason,
          humanIntervention: toHumanInterventionEventData({
            approvalRequestId: interrupted.approvalRequestId,
            status: "requested",
            runId: interrupted.runId,
            workflowIntentId: interrupted.workflowIntentId,
            toolName: urlInspectToolName,
            reason: policy.reason,
          }),
        },
        error: policy.reason,
        details: toolPolicyError(policy),
        policyDecisionId,
      },
      { status: policy.status },
    );
  }

  const recordsStartedAtMs = Date.now();
  const runIdentity = await insertToolRunRecords(env, identity, {
    url: validated.url,
    executionMode: policy.executionMode,
    policyDecisionId,
    parentRun,
    sandboxConstraints: resourcePolicy.constraints,
  });
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Run queued and tool-call record write",
      layer: "d1",
      startedAtMs: recordsStartedAtMs,
      data: { runId: runIdentity.runId, workflowIntentId: runIdentity.workflowIntentId },
    });
  }
  const toolStartedAtMs = Date.now();
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "Tool started",
      layer: "tool",
      startedAtMs: toolStartedAtMs,
      endedAtMs: toolStartedAtMs,
      data: { toolName: urlInspectToolName, executionMode },
    });
  }
  const fetchStartedAtMs = Date.now();
  const executionStartedAtMs = Date.now();
  const { result, finished } = await executeUrlInspectRunner(env, runIdentity, validated.url, {
    executionMode: policy.executionMode,
    policyDecisionId,
    traceId: trace?.traceId,
  });
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: "HTTP fetch",
      layer: "tool",
      startedAtMs: fetchStartedAtMs,
      status: result.ok ? "completed" : "failed",
      data: result.ok
        ? {
            status: result.output.status,
            finalUrl: result.output.finalUrl,
            downloadedBytes: result.output.downloadedBytes,
          }
        : { error: result.error },
    });
  }
  const finishStartedAtMs = executionStartedAtMs;
  if (trace) {
    await recordSpan(env, identity, {
      traceId: trace.traceId,
      name: result.ok ? "Artifact/write completion" : "Failure write",
      layer: "d1",
      startedAtMs: finishStartedAtMs,
      status: result.ok ? "completed" : "failed",
      data: {
        runId: runIdentity.runId,
        toolCallId: finished.toolCallId,
        artifactId: finished.artifact?.id ?? null,
      },
    });
    await finishToolTrace(env, identity, trace, {
      status: result.ok ? "completed" : "failed",
      summary: result.ok ? result.output.summary : result.error.message,
      data: {
        runId: runIdentity.runId,
        workflowIntentId: runIdentity.workflowIntentId,
        toolCallId: finished.toolCallId,
        artifactId: finished.artifact?.id ?? null,
        toolName: urlInspectToolName,
        error: result.ok ? undefined : result.error,
      },
    });
  }
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "tool.run.updated",
    data: {
      toolName: urlInspectToolName,
      runId: runIdentity.runId,
      workflowIntentId: runIdentity.workflowIntentId,
      toolCallId: finished.toolCallId,
      artifactId: finished.artifact?.id ?? null,
      status: result.ok ? "completed" : "failed",
      traceId: trace?.traceId,
      relation: relationEventData(runIdentity.relation),
      parentRunId: runIdentity.relation?.parentRunId,
      errorCode: result.ok ? undefined : result.error.code,
    },
  });
  if (trace) {
    await dispatchWorkbenchSessionEvent(env, identity, {
      type: "trace.updated",
      data: {
        traceId: trace.traceId,
        kind: trace.kind,
        status: result.ok ? "completed" : "failed",
        runId: runIdentity.runId,
      },
    });
  }
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "tool-run-updated",
      toolName: urlInspectToolName,
      runId: runIdentity.runId,
      traceId: trace?.traceId,
      relation: relationEventData(runIdentity.relation),
      parentRunId: runIdentity.relation?.parentRunId,
    },
  });
  const [latestToolCalls, latestArtifacts] = await Promise.all([
    listLatestToolCalls(env, identity.scope),
    listLatestArtifacts(env, identity.scope),
  ]);

  const toolCall = latestToolCalls.find((call) => call.id === finished.toolCallId) ?? null;
  const artifact = finished.artifact
    ? (latestArtifacts.find((item) => item.id === finished.artifact?.id) ?? finished.artifact)
    : null;

  return json(
    {
      ok: result.ok,
      run: {
        id: runIdentity.runId,
        workflowIntentId: runIdentity.workflowIntentId,
        status: result.ok ? "completed" : "failed",
        execution: { mode: policy.executionMode, policy: urlInspectPolicy },
        policyDecisionId,
        relation: relationEventData(runIdentity.relation),
      },
      toolCall,
      artifact,
      error: result.ok ? undefined : result.error,
    },
    { status: result.ok ? 201 : 502 },
  );
};
