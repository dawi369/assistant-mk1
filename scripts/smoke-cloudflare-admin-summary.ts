import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
  sleep,
} from "./smoke-utils";

type AdminSummaryResponse = {
  ok?: boolean;
  summary?: {
    identity?: {
      userId?: string;
      workspaceId?: string;
      agentId?: string;
    };
    account?: {
      id?: string;
      source?: string;
    } | null;
    workspace?: {
      id?: string;
      status?: string;
      isDefault?: boolean;
    } | null;
    membership?: {
      role?: string;
      status?: string;
    } | null;
    defaultAgent?: {
      id?: string;
      status?: string;
      isDefault?: boolean;
    } | null;
    agents?: Array<{
      id?: string;
      isDefault?: boolean;
    }>;
    chat?: {
      latestSession?: {
        sessionId?: string;
      } | null;
    };
    demo?: {
      latestRun?: {
        run?: {
          id?: string;
          status?: string;
        } | null;
      } | null;
    };
    events?: Array<{
      type?: string;
    }>;
    lastError?: {
      message?: string;
    } | null;
  };
  error?: string;
};

type SessionResponse = {
  ok?: boolean;
  session?: {
    sessionId?: string;
  } | null;
  error?: string;
};

type DemoRunResponse = {
  ok?: boolean;
  snapshot?: {
    run?: {
      id?: string;
      status?: string;
    } | null;
  } | null;
  error?: string;
};

const { baseUrl, suffix, pollTimeoutMs, pollIntervalMs, readJson } = createSmokeContext({
  pollIntervalDefault: 500,
});

const accountId = `workos-org:admin-summary-org-${suffix}`;

const identity: TenantIdentity = {
  userId: `admin-summary-user-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(accountId),
  email: `admin-summary-${suffix}@example.com`,
  name: "Admin Summary Smoke User",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:demo"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const requireSummary = (body: AdminSummaryResponse, label: string) => {
  if (!body.ok || !body.summary) throw new Error(`${label} did not return a summary`);
  const summary = body.summary;

  if (
    summary.identity?.userId !== identity.userId ||
    summary.identity.workspaceId !== identity.workspaceId
  ) {
    throw new Error(`${label} returned the wrong identity scope`);
  }
  if (
    summary.account?.id !== identity.accountId ||
    summary.account?.source !== identity.accountSource
  ) {
    throw new Error(`${label} returned the wrong account identity`);
  }
  if (summary.workspace?.id !== identity.workspaceId || !summary.workspace?.isDefault) {
    throw new Error(`${label} did not return the default workspace`);
  }
  if (summary.membership?.status !== "active" || summary.membership.role !== identity.role) {
    throw new Error(`${label} did not return the active membership`);
  }
  if (!summary.defaultAgent?.id || !summary.defaultAgent.isDefault) {
    throw new Error(`${label} did not return the default agent`);
  }
  if (!summary.agents?.some((agent) => agent.id === summary.defaultAgent?.id)) {
    throw new Error(`${label} agent list is missing the default agent`);
  }
  return summary;
};

const waitForDemoRunInSummary = async (runId: string) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    const summary = requireSummary(
      await readJson<AdminSummaryResponse>("/admin/workspace-summary", identity),
      "polled admin summary",
    );

    if (summary.demo?.latestRun?.run?.id === runId) {
      const status = summary.demo.latestRun.run.status;
      if (status === "completed") return summary;
      if (status === "failed" || status === "cancelled") {
        throw new Error(`demo run reached terminal status ${status}`);
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`admin summary did not show completed demo run within ${pollTimeoutMs}ms`);
};

runSmoke("Cloudflare admin summary smoke", async () => {
  console.log(`Smoking Cloudflare admin summary at ${baseUrl}`);

  const initial = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", identity),
    "initial admin summary",
  );
  if (initial.demo?.latestRun) throw new Error("new tenant unexpectedly had a demo run");

  const session = await readJson<SessionResponse>("/sessions", identity, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "admin-summary-smoke" } }),
  });
  if (!session.session?.sessionId) throw new Error(session.error ?? "session creation failed");

  const withSession = requireSummary(
    await readJson<AdminSummaryResponse>("/admin/workspace-summary", identity),
    "session admin summary",
  );
  if (withSession.chat?.latestSession?.sessionId !== session.session.sessionId) {
    throw new Error("admin summary did not expose the latest chat session");
  }

  const started = await readJson<DemoRunResponse>("/workbench/demo-runs", identity, {
    method: "POST",
  });
  const runId = started.snapshot?.run?.id;
  if (!runId) throw new Error(started.error ?? "demo run did not start");

  const completed = await waitForDemoRunInSummary(runId);
  if (!completed.events?.length) throw new Error("admin summary did not include recent events");
  if (completed.lastError)
    throw new Error(`admin summary reported an error: ${completed.lastError.message}`);

  console.log(
    JSON.stringify(
      {
        accountId: completed.account?.id,
        workspaceId: completed.identity?.workspaceId,
        agentId: completed.identity?.agentId,
        sessionId: completed.chat?.latestSession?.sessionId,
        runId,
        eventCount: completed.events?.length ?? 0,
      },
      null,
      2,
    ),
  );
});

export {};
