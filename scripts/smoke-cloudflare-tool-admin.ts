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
  reason?: string;
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

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    latestToolCalls?: Array<{
      id?: string;
      runId?: string;
      toolId?: string;
      status?: string;
    }>;
    latestArtifacts?: Array<{
      id?: string;
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

runSmoke("Cloudflare tool admin smoke", async () => {
  console.log(`Smoking Cloudflare tool admin at ${baseUrl}`);

  const tools = await readJson<ToolsResponse>("/tools", owner);
  const urlInspect = requireTool(tools.tools, "url.inspect");
  if (!urlInspect.adminVisible) throw new Error("url.inspect should be Admin-visible for owner");
  if (urlInspect.modelVisible) throw new Error("url.inspect should not be model-visible in v0");

  const demoInspect = requireTool(tools.tools, "demo.inspect");
  if (demoInspect.modelVisible) throw new Error("demo.inspect should not be model-visible");

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

  const adminSummary = await readJson<AdminSummaryResponse>("/admin/workspace-summary", owner);
  if (!adminSummary.summary?.latestToolCalls?.some((call) => call.id === run.toolCall?.id)) {
    throw new Error("admin summary did not include the latest tool call");
  }
  if (!adminSummary.summary.latestArtifacts?.some((artifact) => artifact.id === run.artifact?.id)) {
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
  if (otherTools.latestToolCalls?.some((call) => call.id === run.toolCall?.id)) {
    throw new Error("cross-tenant /tools leaked owner tool call");
  }
  const otherSummary = await readJson<AdminSummaryResponse>(
    "/admin/workspace-summary",
    otherTenant,
  );
  if (otherSummary.summary?.latestToolCalls?.some((call) => call.id === run.toolCall?.id)) {
    throw new Error("cross-tenant admin summary leaked owner tool call");
  }

  console.log(
    JSON.stringify(
      {
        runId: run.run.id,
        toolCallId: run.toolCall.id,
        artifactId: run.artifact.id,
      },
      null,
      2,
    ),
  );
});

export {};
