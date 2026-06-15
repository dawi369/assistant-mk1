import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

type ToolSummary = {
  name?: string;
  adminVisible?: boolean;
  modelVisible?: boolean;
  permissionStatus?: string;
  policyReference?: string;
  allowedExecutionModes?: string[];
  approvalRequired?: boolean;
  killSwitchReason?: string;
  reason?: string;
  adminPolicy?: {
    decision?: string;
    code?: string;
    reason?: string;
  };
  modelExposurePolicy?: {
    decision?: string;
    code?: string;
    reason?: string;
  };
  latestApprovalRequest?: {
    id?: string;
    status?: string;
    reason?: string;
  };
};

type ToolsResponse = {
  ok?: boolean;
  tools?: ToolSummary[];
  latestToolCalls?: Array<{
    id?: string;
    runId?: string;
    toolId?: string;
    status?: string;
    outputSummary?: string;
  }>;
  latestArtifacts?: Array<{
    id?: string;
    title?: string;
  }>;
  error?: string;
};

type ToolRunResponse = {
  ok?: boolean;
  run?: {
    id?: string;
    status?: string;
    workflowIntentId?: string;
  };
  approvalRequest?: {
    id?: string;
    status?: string;
    reason?: string;
  };
  toolCall?: {
    id?: string;
    toolId?: string;
    status?: string;
  } | null;
  artifact?: {
    id?: string;
  } | null;
  error?: {
    code?: string;
  };
};

type ToolApprovalActionResponse = ToolRunResponse;

type ToolApprovalSummary = {
  id?: string;
  status?: string;
  toolId?: string;
  runId?: string;
  workflowIntentId?: string;
  input?: { url?: string };
  decision?: {
    denyReason?: string;
    decidedAt?: string;
    policyDecisionId?: string;
  };
  currentPolicy?: {
    decision?: string;
    code?: string;
    reason?: string;
  };
};

type ToolApprovalsResponse = {
  ok?: boolean;
  approvals?: ToolApprovalSummary[];
  details?: { code?: string };
  error?: string;
};

type ToolPolicyUpdateResponse = {
  ok?: boolean;
  toolName?: string;
  status?: string;
  requiresApproval?: boolean;
  modelVisible?: boolean;
  permissionId?: string;
  tool?: ToolSummary;
  error?: string;
};

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    demo?: {
      latestRun?: {
        run?: {
          id?: string;
          status?: string;
        } | null;
        toolCalls?: Array<{ id?: string; runId?: string }>;
        artifacts?: Array<{ id?: string }>;
        auditEvents?: Array<{ action?: string; targetId?: string }>;
      } | null;
    };
    latestToolCalls?: Array<{
      id?: string;
      runId?: string;
      toolId?: string;
      status?: string;
    }>;
    latestArtifacts?: Array<{
      id?: string;
    }>;
    events?: Array<{
      type?: string;
      targetId?: string;
    }>;
  };
  error?: string;
};

const { baseUrl, suffix, readJson, fetchRaw } = createSmokeContext();

const accountId = `workos-org:tool-admin-org-${suffix}`;
const workspaceId = defaultWorkspaceId(accountId);

const owner: TenantIdentity = {
  userId: `tool-owner-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId,
  email: `tool-owner-${suffix}@example.com`,
  name: "Tool Owner",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:tools"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const member: TenantIdentity = {
  ...owner,
  userId: `tool-member-${suffix}`,
  email: `tool-member-${suffix}@example.com`,
  name: "Tool Member",
  role: "member",
  roles: ["member"],
};

const otherTenant: TenantIdentity = {
  ...owner,
  userId: `tool-other-${suffix}`,
  accountId: `workos-org:tool-other-org-${suffix}`,
  workspaceId: defaultWorkspaceId(`workos-org:tool-other-org-${suffix}`),
  email: `tool-other-${suffix}@example.com`,
};

const requireTool = (tools: ToolSummary[] | undefined, name: string) => {
  const tool = tools?.find((item) => item.name === name);
  if (!tool) throw new Error(`${name} was not returned by /tools`);
  return tool;
};

const requireApproval = (
  approvals: ToolApprovalSummary[] | undefined,
  approvalId: string | undefined,
) => {
  const approval = approvals?.find((item) => item.id === approvalId);
  if (!approval) throw new Error(`approval ${approvalId ?? "unknown"} was not returned`);
  return approval;
};

const expectErrorCode = async (response: Response, status: number, code: string) => {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { details?: { code?: string }; error?: unknown };
  if (body.details?.code !== code) {
    throw new Error(`expected error code ${code}, got ${JSON.stringify(body)}`);
  }
};

const readErrorBody = async (response: Response, status: number, code: string) => {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as ToolRunResponse & {
    details?: { code?: string };
  };
  if (body.details?.code !== code) {
    throw new Error(`expected error code ${code}, got ${JSON.stringify(body)}`);
  }
  return body;
};

runSmoke("Cloudflare tool admin smoke", async () => {
  console.log(`Smoking Cloudflare tool admin at ${baseUrl}`);

  const tools = await readJson<ToolsResponse>("/tools", owner);
  const urlInspect = requireTool(tools.tools, "url.inspect");
  if (!urlInspect.adminVisible) throw new Error("url.inspect should be Admin-visible for owner");
  if (urlInspect.modelVisible) throw new Error("url.inspect should not be model-visible in v0");
  if (urlInspect.modelExposurePolicy?.code !== "model_exposure_blocked") {
    throw new Error(`url.inspect should explain model exposure: ${JSON.stringify(urlInspect)}`);
  }
  if (urlInspect.permissionStatus !== "enabled") {
    throw new Error(`url.inspect should seed enabled, got ${urlInspect.permissionStatus}`);
  }
  if (urlInspect.policyReference !== "tool-admin-readonly-v0") {
    throw new Error(`url.inspect policy reference missing: ${JSON.stringify(urlInspect)}`);
  }

  const demoInspect = requireTool(tools.tools, "demo.inspect");
  if (demoInspect.modelVisible) throw new Error("demo.inspect should not be model-visible");
  if (demoInspect.modelExposurePolicy?.code !== "model_exposure_blocked") {
    throw new Error(`demo.inspect should explain model exposure: ${JSON.stringify(demoInspect)}`);
  }

  const invalid = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "not a url" },
    }),
  });
  await expectErrorCode(invalid, 400, "invalid_url");

  const blocked = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "http://127.0.0.1:8787/health" },
    }),
  });
  await expectErrorCode(blocked, 403, "url_blocked");

  const run = await readJson<ToolRunResponse>("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  if (!run.ok || run.run?.status !== "completed") {
    throw new Error(`url.inspect run did not complete: ${JSON.stringify(run)}`);
  }
  if (run.toolCall?.toolId !== "url.inspect" || run.toolCall.status !== "completed") {
    throw new Error("url.inspect run did not return a completed tool call");
  }
  if (!run.artifact?.id) throw new Error("url.inspect run did not return an artifact");

  const approvalPolicy = await readJson<ToolPolicyUpdateResponse>("/tools/policy", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      requiresApproval: true,
    }),
  });
  if (
    !approvalPolicy.ok ||
    !approvalPolicy.requiresApproval ||
    !approvalPolicy.tool?.approvalRequired
  ) {
    throw new Error(
      `url.inspect approval policy did not update: ${JSON.stringify(approvalPolicy)}`,
    );
  }

  const approvalTools = await readJson<ToolsResponse>("/tools", owner);
  const approvalUrlInspect = requireTool(approvalTools.tools, "url.inspect");
  if (!approvalUrlInspect.approvalRequired) {
    throw new Error("url.inspect should show approval required");
  }

  const approvalRunResponse = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  const approvalRun = await readErrorBody(approvalRunResponse, 403, "approval_required");
  if (approvalRun.run?.status !== "interrupted" || !approvalRun.run.id) {
    throw new Error(`approval-required run should be interrupted: ${JSON.stringify(approvalRun)}`);
  }
  if (approvalRun.toolCall || approvalRun.artifact) {
    throw new Error(
      `approval-required run should not execute tool: ${JSON.stringify(approvalRun)}`,
    );
  }
  if (approvalRun.approvalRequest?.status !== "requested" || !approvalRun.approvalRequest.id) {
    throw new Error(`approval request missing: ${JSON.stringify(approvalRun)}`);
  }

  const requestedApprovals = await readJson<ToolApprovalsResponse>(
    "/tools/approvals?status=requested",
    owner,
  );
  const requestedApproval = requireApproval(
    requestedApprovals.approvals,
    approvalRun.approvalRequest.id,
  );
  if (requestedApproval.status !== "requested" || requestedApproval.toolId !== "url.inspect") {
    throw new Error(`requested approval queue entry invalid: ${JSON.stringify(requestedApproval)}`);
  }
  if (requestedApproval.input?.url !== "https://example.com/") {
    throw new Error(`requested approval input URL missing: ${JSON.stringify(requestedApproval)}`);
  }
  if (requestedApproval.currentPolicy?.decision !== "allow") {
    throw new Error(
      `requested approval should be currently approvable: ${JSON.stringify(requestedApproval)}`,
    );
  }

  const approvalSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  const interruptedSnapshot = approvalSummary.summary?.demo?.latestRun;
  if (interruptedSnapshot?.run?.id !== approvalRun.run.id) {
    throw new Error("admin summary did not surface the interrupted approval run");
  }
  if (interruptedSnapshot.run?.status !== "interrupted") {
    throw new Error(`interrupted run status missing: ${JSON.stringify(interruptedSnapshot)}`);
  }
  if (interruptedSnapshot.toolCalls?.length) {
    throw new Error("approval-required run should not create a tool call");
  }
  if (interruptedSnapshot.artifacts?.length) {
    throw new Error("approval-required run should not create an artifact");
  }
  if (!interruptedSnapshot.auditEvents?.some((event) => event.action === "run.interrupted")) {
    throw new Error("run.interrupted audit event missing");
  }
  if (!interruptedSnapshot.auditEvents?.some((event) => event.action === "approval.requested")) {
    throw new Error("approval.requested audit event missing");
  }
  if (!approvalSummary.summary?.events?.some((event) => event.type === "run.interrupted")) {
    throw new Error("run.interrupted control-plane event missing");
  }
  if (!approvalSummary.summary?.events?.some((event) => event.type === "approval.requested")) {
    throw new Error("approval.requested control-plane event missing");
  }
  if (!approvalSummary.summary?.events?.some((event) => event.type === "approval.updated")) {
    throw new Error("approval.updated control-plane event missing for requested approval");
  }

  const approvalToolsAfterRun = await readJson<ToolsResponse>("/tools", owner);
  const approvalToolAfterRun = requireTool(approvalToolsAfterRun.tools, "url.inspect");
  if (approvalToolAfterRun.latestApprovalRequest?.id !== approvalRun.approvalRequest.id) {
    throw new Error("latest approval request was not attached to /tools summary");
  }

  const approved = await readJson<ToolApprovalActionResponse>(
    `/tools/approvals/${encodeURIComponent(approvalRun.approvalRequest.id)}/approve`,
    owner,
    { method: "POST" },
  );
  if (!approved.ok || approved.run?.status !== "completed") {
    throw new Error(`approved run should execute original request: ${JSON.stringify(approved)}`);
  }
  if (approved.toolCall?.toolId !== "url.inspect" || approved.toolCall.status !== "completed") {
    throw new Error("approved run did not return a completed tool call");
  }
  if (!approved.artifact?.id) throw new Error("approved run did not create an artifact");
  if (approved.approvalRequest?.status !== "approved") {
    throw new Error(
      `approved response should include updated approval: ${JSON.stringify(approved)}`,
    );
  }

  const decidedAfterApprove = await readJson<ToolApprovalsResponse>(
    "/tools/approvals?status=decided",
    owner,
  );
  const approvedApproval = requireApproval(
    decidedAfterApprove.approvals,
    approvalRun.approvalRequest.id,
  );
  if (approvedApproval.status !== "approved" || !approvedApproval.decision?.decidedAt) {
    throw new Error(`approved approval queue entry invalid: ${JSON.stringify(approvedApproval)}`);
  }

  const approvedSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (!approvedSummary.summary?.events?.some((event) => event.type === "approval.approved")) {
    throw new Error("approval.approved control-plane event missing");
  }
  if (!approvedSummary.summary?.events?.some((event) => event.type === "run.resumed")) {
    throw new Error("run.resumed control-plane event missing");
  }
  if (!approvedSummary.summary?.events?.some((event) => event.type === "approval.updated")) {
    throw new Error("approval.updated control-plane event missing for approved approval");
  }

  const denyRunResponse = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  const denyRun = await readErrorBody(denyRunResponse, 403, "approval_required");
  if (denyRun.approvalRequest?.status !== "requested" || !denyRun.approvalRequest.id) {
    throw new Error(`deny approval request missing: ${JSON.stringify(denyRun)}`);
  }
  const denied = await readJson<ToolApprovalActionResponse>(
    `/tools/approvals/${encodeURIComponent(denyRun.approvalRequest.id)}/deny`,
    owner,
    {
      method: "POST",
      body: JSON.stringify({ reason: "Smoke test denial." }),
    },
  );
  if (!denied.ok || denied.run?.status !== "cancelled") {
    throw new Error(`denied run should cancel: ${JSON.stringify(denied)}`);
  }
  if (denied.toolCall || denied.artifact) {
    throw new Error(`denied run should not execute tool: ${JSON.stringify(denied)}`);
  }
  if (denied.approvalRequest?.status !== "denied") {
    throw new Error(`denied response should include updated approval: ${JSON.stringify(denied)}`);
  }

  const decidedAfterDeny = await readJson<ToolApprovalsResponse>(
    "/tools/approvals?status=decided",
    owner,
  );
  const deniedApproval = requireApproval(decidedAfterDeny.approvals, denyRun.approvalRequest.id);
  if (
    deniedApproval.status !== "denied" ||
    deniedApproval.decision?.denyReason !== "Smoke test denial."
  ) {
    throw new Error(`denied approval queue entry invalid: ${JSON.stringify(deniedApproval)}`);
  }

  const deniedSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (!deniedSummary.summary?.events?.some((event) => event.type === "approval.denied")) {
    throw new Error("approval.denied control-plane event missing");
  }
  if (!deniedSummary.summary?.events?.some((event) => event.type === "run.cancelled")) {
    throw new Error("run.cancelled control-plane event missing");
  }

  const pendingBeforeDisableResponse = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  const pendingBeforeDisable = await readErrorBody(
    pendingBeforeDisableResponse,
    403,
    "approval_required",
  );
  if (!pendingBeforeDisable.approvalRequest?.id) {
    throw new Error("pending approval before disable was not created");
  }

  const disabled = await readJson<ToolPolicyUpdateResponse>("/tools/policy", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      status: "disabled",
    }),
  });
  if (!disabled.ok || disabled.status !== "disabled") {
    throw new Error(`url.inspect policy did not disable: ${JSON.stringify(disabled)}`);
  }

  const disabledTools = await readJson<ToolsResponse>("/tools", owner);
  const disabledUrlInspect = requireTool(disabledTools.tools, "url.inspect");
  if (disabledUrlInspect.permissionStatus !== "disabled") {
    throw new Error(`url.inspect should show disabled, got ${disabledUrlInspect.permissionStatus}`);
  }
  if (disabledUrlInspect.adminVisible) {
    throw new Error("disabled url.inspect should not be Admin-visible");
  }
  if (!disabledUrlInspect.killSwitchReason) {
    throw new Error("disabled url.inspect should include a kill-switch reason");
  }

  const disabledApproval = await fetchRaw(
    `/tools/approvals/${encodeURIComponent(pendingBeforeDisable.approvalRequest.id)}/approve`,
    owner,
    { method: "POST" },
  );
  await expectErrorCode(disabledApproval, 403, "tool_disabled");

  const disabledApprovalQueue = await readJson<ToolApprovalsResponse>(
    "/tools/approvals?status=requested",
    owner,
  );
  const blockedApproval = requireApproval(
    disabledApprovalQueue.approvals,
    pendingBeforeDisable.approvalRequest.id,
  );
  if (blockedApproval.currentPolicy?.code !== "tool_disabled") {
    throw new Error(
      `disabled pending approval should show tool_disabled: ${JSON.stringify(blockedApproval)}`,
    );
  }

  const deniedAfterDisable = await readJson<ToolApprovalActionResponse>(
    `/tools/approvals/${encodeURIComponent(pendingBeforeDisable.approvalRequest.id)}/deny`,
    owner,
    {
      method: "POST",
      body: JSON.stringify({ reason: "Disabled before approval." }),
    },
  );
  if (!deniedAfterDisable.ok || deniedAfterDisable.run?.status !== "cancelled") {
    throw new Error(
      `disabled pending approval should still deny: ${JSON.stringify(deniedAfterDisable)}`,
    );
  }

  const disabledRun = await fetchRaw("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  await expectErrorCode(disabledRun, 403, "tool_disabled");

  const disabledSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (disabledSummary.summary?.demo?.latestRun?.run?.id !== pendingBeforeDisable.run?.id) {
    throw new Error("disabled tool run should not create a new interrupted run");
  }

  const enabled = await readJson<ToolPolicyUpdateResponse>("/tools/policy", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      status: "enabled",
      requiresApproval: false,
    }),
  });
  if (!enabled.ok || enabled.status !== "enabled" || enabled.requiresApproval) {
    throw new Error(`url.inspect policy did not re-enable: ${JSON.stringify(enabled)}`);
  }

  const exposed = await readJson<ToolPolicyUpdateResponse>("/tools/policy", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      modelVisible: true,
    }),
  });
  if (!exposed.ok || !exposed.tool?.modelVisible) {
    throw new Error(`url.inspect model exposure did not enable: ${JSON.stringify(exposed)}`);
  }
  if (exposed.tool.modelExposurePolicy?.decision !== "allow") {
    throw new Error(`url.inspect model exposure should be allowed: ${JSON.stringify(exposed)}`);
  }

  const memberTools = await readJson<ToolsResponse>("/tools", member);
  const memberUrlInspect = requireTool(memberTools.tools, "url.inspect");
  if (memberUrlInspect.modelVisible) {
    throw new Error("member should not inherit owner model-visible policy");
  }

  const memberPolicyUpdate = await fetchRaw("/tools/policy", member, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      modelVisible: true,
    }),
  });
  await expectErrorCode(memberPolicyUpdate, 403, "admin_required");

  const memberApprovals = await fetchRaw("/tools/approvals?status=all", member);
  await expectErrorCode(memberApprovals, 403, "admin_required");
  const memberApprove = await fetchRaw(
    `/tools/approvals/${encodeURIComponent(approvalRun.approvalRequest.id)}/approve`,
    member,
    { method: "POST" },
  );
  await expectErrorCode(memberApprove, 403, "admin_required");
  const memberDeny = await fetchRaw(
    `/tools/approvals/${encodeURIComponent(approvalRun.approvalRequest.id)}/deny`,
    member,
    { method: "POST", body: JSON.stringify({ reason: "member blocked" }) },
  );
  await expectErrorCode(memberDeny, 403, "admin_required");

  const rerun = await readJson<ToolRunResponse>("/tools/runs", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  if (!rerun.ok || rerun.run?.status !== "completed") {
    throw new Error(`url.inspect run did not recover after re-enable: ${JSON.stringify(rerun)}`);
  }
  if (rerun.toolCall?.toolId !== "url.inspect" || rerun.toolCall.status !== "completed") {
    throw new Error("re-enabled url.inspect run did not return a completed tool call");
  }
  if (!rerun.artifact?.id) throw new Error("re-enabled url.inspect run did not return artifact");

  const adminSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (!adminSummary.summary?.latestToolCalls?.some((call) => call.id === rerun.toolCall?.id)) {
    throw new Error("admin summary did not include the latest tool call");
  }
  if (
    !adminSummary.summary.latestArtifacts?.some((artifact) => artifact.id === rerun.artifact?.id)
  ) {
    throw new Error("admin summary did not include the latest tool artifact");
  }

  const memberRun = await fetchRaw("/tools/runs", member, {
    method: "POST",
    body: JSON.stringify({
      toolName: "url.inspect",
      executionMode: "dry_run",
      input: { url: "https://example.com" },
    }),
  });
  if (memberRun.status !== 403) {
    throw new Error(`member tool run expected 403, got ${memberRun.status}`);
  }

  const otherTools = await readJson<ToolsResponse>("/tools", otherTenant);
  if (otherTools.latestToolCalls?.some((call) => call.id === rerun.toolCall?.id)) {
    throw new Error("cross-tenant /tools leaked owner tool call");
  }
  const otherApprovals = await readJson<ToolApprovalsResponse>(
    "/tools/approvals?status=all",
    otherTenant,
  );
  if (
    otherApprovals.approvals?.some((approval) => approval.id === approvalRun.approvalRequest?.id)
  ) {
    throw new Error("cross-tenant /tools/approvals leaked owner approval");
  }
  const otherApprove = await fetchRaw(
    `/tools/approvals/${encodeURIComponent(approvalRun.approvalRequest.id)}/approve`,
    otherTenant,
    { method: "POST" },
  );
  await expectErrorCode(otherApprove, 404, "approval_not_found");
  const otherSummary = await readJson<AdminSummaryResponse>(
    "/admin/workspace-summary",
    otherTenant,
  );
  if (otherSummary.summary?.latestToolCalls?.some((call) => call.id === rerun.toolCall?.id)) {
    throw new Error("cross-tenant admin summary leaked owner tool call");
  }

  console.log(
    JSON.stringify(
      {
        runId: rerun.run.id,
        toolCallId: rerun.toolCall.id,
        artifactId: rerun.artifact.id,
        disabledPermissionId: disabled.permissionId,
      },
      null,
      2,
    ),
  );
});

export {};
