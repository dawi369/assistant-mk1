import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

type SessionResponse = {
  ok?: boolean;
  session?: {
    sessionId?: string;
    agentId?: string;
    scope?: {
      userId?: string;
      workspaceId?: string;
    };
  } | null;
  error?: string;
};

type ResolvedSession = {
  sessionId: string;
  agentId: string;
};

const { baseUrl, suffix, headersFor, readJson } = createSmokeContext();

const tenantA: TenantIdentity = {
  userId: `authz-user-a-${suffix}`,
  accountId: `workos-org:authz-org-a-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:authz-org-a-${suffix}`),
  email: `authz-a-${suffix}@example.com`,
  name: "Authz Smoke User A",
  role: "admin",
  roles: ["admin"],
  permissions: ["workbench:read"],
};

const tenantB: TenantIdentity = {
  userId: `authz-user-b-${suffix}`,
  accountId: `workos-org:authz-org-b-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:authz-org-b-${suffix}`),
  email: `authz-b-${suffix}@example.com`,
  name: "Authz Smoke User B",
  role: "member",
  roles: ["member"],
  permissions: ["workbench:read"],
};

const disabledTenant: TenantIdentity = {
  userId: `authz-disabled-user-${suffix}`,
  accountId: `workos-org:authz-disabled-org-${suffix}`,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(`workos-org:authz-disabled-org-${suffix}`),
  email: `authz-disabled-${suffix}@example.com`,
  name: "Authz Smoke Disabled User",
  role: "member",
  membershipStatus: "disabled",
};

const createSession = (identity: TenantIdentity) =>
  readJson<SessionResponse>("/sessions", identity, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "authz-smoke" } }),
  });

const requireSession = (
  body: SessionResponse,
  identity: TenantIdentity,
  label: string,
): ResolvedSession => {
  const session = body.session;
  if (!body.ok || !session?.sessionId || !session.agentId) {
    throw new Error(`${label} did not return a resolved session and agent`);
  }
  if (
    session.scope?.userId !== identity.userId ||
    session.scope.workspaceId !== identity.workspaceId
  ) {
    throw new Error(`${label} returned the wrong tenant scope`);
  }
  return {
    sessionId: session.sessionId,
    agentId: session.agentId,
  };
};

const assertSessionHidden = async (identity: TenantIdentity, sessionId: string, label: string) => {
  const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: headersFor(identity),
  });
  if (response.status !== 404) {
    throw new Error(
      `${label} expected cross-workspace session read to return 404, got ${response.status}`,
    );
  }
};

const assertDisabledMembership = async () => {
  const first = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: headersFor(disabledTenant),
    body: "{}",
  });
  if (first.status !== 403) {
    throw new Error(`disabled membership bootstrap expected 403, got ${first.status}`);
  }

  const second = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: headersFor({ ...disabledTenant, membershipStatus: undefined }),
    body: "{}",
  });
  if (second.status !== 403) {
    throw new Error(`stored disabled membership expected 403, got ${second.status}`);
  }
};

runSmoke("Cloudflare D1 authz smoke", async () => {
  console.log(`Smoking Cloudflare D1 authz at ${baseUrl}`);

  const sessionA = requireSession(await createSession(tenantA), tenantA, "tenant A session");
  const latestA = requireSession(
    await readJson<SessionResponse>("/sessions/latest", tenantA),
    tenantA,
    "tenant A latest session",
  );
  const sessionB = requireSession(await createSession(tenantB), tenantB, "tenant B session");

  if (latestA.agentId !== sessionA.agentId) {
    throw new Error("default agent resolution changed between tenant A requests");
  }

  await assertSessionHidden(tenantB, sessionA.sessionId, "tenant B");
  await assertSessionHidden(tenantA, sessionB.sessionId, "tenant A");
  await assertDisabledMembership();

  console.log(
    JSON.stringify(
      {
        tenantAAgentId: sessionA.agentId,
        tenantASessionId: sessionA.sessionId,
        tenantBAgentId: sessionB.agentId,
        tenantBSessionId: sessionB.sessionId,
      },
      null,
      2,
    ),
  );
});

export {};
