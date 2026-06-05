type TenantIdentity = {
  userId: string;
  workspaceId: string;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  membershipStatus?: string;
};

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

const baseUrl = (process.env.CLOUDFLARE_CONTROL_PLANE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);
const token = process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN ?? "local-dev-token";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const tenantA: TenantIdentity = {
  userId: `authz-user-a-${suffix}`,
  workspaceId: `authz-workspace-a-${suffix}`,
  email: `authz-a-${suffix}@example.com`,
  name: "Authz Smoke User A",
  role: "admin",
  roles: ["admin"],
  permissions: ["workbench:read"],
};

const tenantB: TenantIdentity = {
  userId: `authz-user-b-${suffix}`,
  workspaceId: `authz-workspace-b-${suffix}`,
  email: `authz-b-${suffix}@example.com`,
  name: "Authz Smoke User B",
  role: "member",
  roles: ["member"],
  permissions: ["workbench:read"],
};

const disabledTenant: TenantIdentity = {
  userId: `authz-disabled-user-${suffix}`,
  workspaceId: `authz-disabled-workspace-${suffix}`,
  email: `authz-disabled-${suffix}@example.com`,
  name: "Authz Smoke Disabled User",
  role: "member",
  membershipStatus: "disabled",
};

const headersFor = (identity: TenantIdentity) => {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-assistant-mk1-user-id": identity.userId,
    "x-assistant-mk1-workspace-id": identity.workspaceId,
  };

  if (identity.email) headers["x-assistant-mk1-user-email"] = identity.email;
  if (identity.name) headers["x-assistant-mk1-user-name"] = identity.name;
  if (identity.role) headers["x-assistant-mk1-membership-role"] = identity.role;
  if (identity.roles) headers["x-assistant-mk1-membership-roles"] = JSON.stringify(identity.roles);
  if (identity.permissions) {
    headers["x-assistant-mk1-membership-permissions"] = JSON.stringify(identity.permissions);
  }
  if (identity.membershipStatus) {
    headers["x-assistant-mk1-membership-status"] = identity.membershipStatus;
  }

  return headers;
};

const readJson = async <T>(
  path: string,
  identity: TenantIdentity,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headersFor(identity),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed with ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
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

const main = async () => {
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

  console.log("Cloudflare D1 authz smoke passed");
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
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export {};
