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

type ToolPolicyUpdateResponse = {
  ok?: boolean;
  toolName?: string;
  status?: string;
  requiresApproval?: boolean;
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

  const approvalToolsAfterRun = await readJson<ToolsResponse>("/tools", owner);
  const approvalToolAfterRun = requireTool(approvalToolsAfterRun.tools, "url.inspect");
  if (approvalToolAfterRun.latestApprovalRequest?.id !== approvalRun.approvalRequest.id) {
    throw new Error("latest approval request was not attached to /tools summary");
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
  if (disabledSummary.summary?.demo?.latestRun?.run?.id !== approvalRun.run.id) {
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

  await readJson<ToolsResponse>("/tools", member);
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
