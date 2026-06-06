import {
  accountIdHeader,
  accountSourceHeader,
  agentIdHeader,
  json,
  parseJson,
  readRequiredHeader,
  userIdHeader,
  workspaceIdHeader,
} from "./http";
import {
  countWorkspaceMemberships,
  selectActiveWorkspacePreference,
  selectDefaultAgent,
  selectDefaultWorkspaceForAccount,
  selectMembership,
  selectUser,
  selectWorkspace,
} from "./authz-store";
import { adminMembershipRoles } from "./membership-policy";
import { createId, toJson, type AgentIdentity, type Env } from "./types";

const userEmailHeader = "x-assistant-mk1-user-email";
const userNameHeader = "x-assistant-mk1-user-name";
const membershipRoleHeader = "x-assistant-mk1-membership-role";
const membershipRolesHeader = "x-assistant-mk1-membership-roles";
const membershipPermissionsHeader = "x-assistant-mk1-membership-permissions";
const membershipStatusHeader = "x-assistant-mk1-membership-status";
const workspaceNameHeader = "x-assistant-mk1-workspace-name";
const workspaceStatusHeader = "x-assistant-mk1-workspace-status";

type ResolveResult = { ok: true; identity: AgentIdentity } | { ok: false; response: Response };

const readOptionalHeader = (request: Request, name: string) =>
  request.headers.get(name)?.trim() || undefined;

const parseStringArrayHeader = (value: string | undefined) => {
  if (!value) return [];
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
};

const firstPresent = (...values: Array<string | undefined>) =>
  values.find((value) => value && value.trim())?.trim();

export const defaultAgentId = (workspaceId: string) => `agent-${workspaceId}`;
export const defaultWorkspaceId = (accountId: string) => `workspace:${accountId}:default`;

const normalizedAdminRole = (role: string | undefined) => {
  const normalized = role?.trim().toLowerCase();
  return normalized && adminMembershipRoles.has(normalized) ? normalized : undefined;
};

const initialMembershipSeed = (input: {
  isFirstMembership: boolean;
  externalRole?: string;
  externalRoles: string[];
  externalPermissions: string[];
  status?: string;
}) => {
  const externalAdminRole =
    normalizedAdminRole(input.externalRole) ??
    input.externalRoles.map(normalizedAdminRole).find((role) => role);
  const role = input.isFirstMembership ? "owner" : (externalAdminRole ?? "member");
  const roles = Array.from(
    new Set([
      role,
      ...input.externalRoles.map((externalRole) => externalRole.trim()).filter(Boolean),
    ]),
  );

  return {
    role,
    roles,
    permissions: input.externalPermissions,
    status: input.status ?? "active",
  };
};

const upsertUser = async (
  env: Env,
  input: { userId: string; email?: string; displayName?: string },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, status, data_json, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = COALESCE(excluded.email, users.email),
       display_name = COALESCE(excluded.display_name, users.display_name),
       updated_at = excluded.updated_at`,
  )
    .bind(
      input.userId,
      input.email ?? null,
      input.displayName ?? null,
      toJson({ provider: "workos" }),
      timestamp,
      timestamp,
    )
    .run();
};

const upsertDefaultWorkspace = async (
  env: Env,
  input: {
    workspaceId: string;
    accountId: string;
    accountSource: string;
    userId: string;
    name?: string;
    status?: string;
  },
) => {
  const timestamp = new Date().toISOString();
  const name = input.name ?? "Default Workspace";
  const status = input.status ?? "active";
  await env.DB.prepare(
    `INSERT INTO workspaces (
       id, account_id, account_source, name, status, is_default, created_by_user_id,
       data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       account_id = excluded.account_id,
       account_source = excluded.account_source,
       name = COALESCE(excluded.name, workspaces.name),
       is_default = excluded.is_default,
       updated_at = excluded.updated_at`,
  )
    .bind(
      input.workspaceId,
      input.accountId,
      input.accountSource,
      name,
      status,
      input.userId,
      toJson({
        provider: "workos",
        accountId: input.accountId,
        accountSource: input.accountSource,
      }),
      timestamp,
      timestamp,
    )
    .run();
};

export const insertWorkspace = async (
  env: Env,
  input: {
    workspaceId: string;
    accountId: string;
    accountSource: string;
    userId: string;
    name: string;
    isDefault?: boolean;
  },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspaces (
       id, account_id, account_source, name, status, is_default, created_by_user_id,
       data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.workspaceId,
      input.accountId,
      input.accountSource,
      input.name,
      input.isDefault ? 1 : 0,
      input.userId,
      toJson({
        provider: "workos",
        accountId: input.accountId,
        accountSource: input.accountSource,
      }),
      timestamp,
      timestamp,
    )
    .run();
};

export const upsertMembership = async (
  env: Env,
  input: {
    userId: string;
    workspaceId: string;
    role: string;
    roles: string[];
    permissions: string[];
    status?: string;
  },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO memberships (
       id, user_id, workspace_id, role, status, roles_json, permissions_json, data_json,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, workspace_id) DO UPDATE SET
       updated_at = excluded.updated_at`,
  )
    .bind(
      createId("membership"),
      input.userId,
      input.workspaceId,
      input.role,
      input.status ?? "active",
      toJson(input.roles),
      toJson(input.permissions),
      toJson({ provider: "workos" }),
      timestamp,
      timestamp,
    )
    .run();
};

export const createDefaultAgentIfMissing = async (
  env: Env,
  input: { workspaceId: string; userId: string },
) => {
  const existing = await selectDefaultAgent(env, input.workspaceId);
  if (existing) return;

  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO agents (
       id, workspace_id, name, description, status, is_default, created_by_user_id,
       data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
  )
    .bind(
      defaultAgentId(input.workspaceId),
      input.workspaceId,
      "Default Agent",
      "Auto-bootstrapped default workspace agent.",
      input.userId,
      toJson({ bootstrap: "workos" }),
      timestamp,
      timestamp,
    )
    .run();
};

export const upsertActiveWorkspacePreference = async (
  env: Env,
  input: { userId: string; accountId: string; workspaceId: string; reason: string },
) => {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO active_workspace_preferences (
       user_id, account_id, workspace_id, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, account_id) DO UPDATE SET
       workspace_id = excluded.workspace_id,
       data_json = excluded.data_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      input.userId,
      input.accountId,
      input.workspaceId,
      toJson({ reason: input.reason }),
      timestamp,
      timestamp,
    )
    .run();
};

const bootstrapAuthz = async (
  env: Env,
  request: Request,
  input: { userId: string; accountId: string; accountSource: string; workspaceId: string },
) => {
  const email = readOptionalHeader(request, userEmailHeader);
  const displayName = readOptionalHeader(request, userNameHeader) ?? email;
  const externalRole = firstPresent(readOptionalHeader(request, membershipRoleHeader));
  const roles = parseStringArrayHeader(readOptionalHeader(request, membershipRolesHeader));
  const permissions = parseStringArrayHeader(
    readOptionalHeader(request, membershipPermissionsHeader),
  );
  const membershipStatus = readOptionalHeader(request, membershipStatusHeader);
  const workspaceStatus = readOptionalHeader(request, workspaceStatusHeader);

  await upsertUser(env, { userId: input.userId, email, displayName });
  await upsertDefaultWorkspace(env, {
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    accountSource: input.accountSource,
    userId: input.userId,
    name: readOptionalHeader(request, workspaceNameHeader),
    status: workspaceStatus,
  });
  const membershipCount = await countWorkspaceMemberships(env, input.workspaceId);
  const membershipSeed = initialMembershipSeed({
    isFirstMembership: (membershipCount?.count ?? 0) === 0,
    externalRole,
    externalRoles: roles,
    externalPermissions: permissions,
    status: membershipStatus,
  });
  await upsertMembership(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    ...membershipSeed,
  });
  await createDefaultAgentIfMissing(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
};

const selectActiveWorkspaceId = async (
  env: Env,
  input: { userId: string; accountId: string; defaultWorkspaceId: string },
) => {
  const preference = await selectActiveWorkspacePreference(env, {
    userId: input.userId,
    accountId: input.accountId,
  });

  if (preference) return preference.workspace_id;

  await upsertActiveWorkspacePreference(env, {
    userId: input.userId,
    accountId: input.accountId,
    workspaceId: input.defaultWorkspaceId,
    reason: "default-bootstrap",
  });
  return input.defaultWorkspaceId;
};

export const resolveAgentIdentity = async (request: Request, env: Env): Promise<ResolveResult> => {
  const userId = readRequiredHeader(request, userIdHeader);
  const accountId = readRequiredHeader(request, accountIdHeader);
  const accountSource = readRequiredHeader(request, accountSourceHeader);
  const workspaceId = readRequiredHeader(request, workspaceIdHeader);
  const explicitAgentId = readRequiredHeader(request, agentIdHeader);

  if (!userId) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "x-assistant-mk1-user-id is required",
        },
        { status: 400 },
      ),
    };
  }

  if (explicitAgentId) {
    if (!workspaceId) {
      return {
        ok: false,
        response: json(
          { ok: false, error: "x-assistant-mk1-workspace-id is required for explicit agent" },
          { status: 400 },
        ),
      };
    }
    return {
      ok: true,
      identity: {
        scope: { userId, workspaceId },
        agentId: explicitAgentId,
        accountId: accountId ?? undefined,
        accountSource: accountSource ?? undefined,
      },
    };
  }

  if (!accountId || !accountSource) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "x-assistant-mk1-account-id and x-assistant-mk1-account-source are required",
        },
        { status: 400 },
      ),
    };
  }

  const expectedWorkspaceId = defaultWorkspaceId(accountId);
  if (workspaceId && workspaceId !== expectedWorkspaceId) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Hosted workspace selection is Cloudflare-owned",
        },
        { status: 400 },
      ),
    };
  }

  await bootstrapAuthz(env, request, {
    userId,
    accountId,
    accountSource,
    workspaceId: expectedWorkspaceId,
  });
  const activeWorkspaceId = await selectActiveWorkspaceId(env, {
    userId,
    accountId,
    defaultWorkspaceId: expectedWorkspaceId,
  });

  const user = await selectUser(env, userId);
  if (!user || user.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "User is not active" }, { status: 403 }),
    };
  }

  const workspace = await selectWorkspace(env, activeWorkspaceId);
  if (!workspace || workspace.account_id !== accountId || workspace.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "Workspace is not active" }, { status: 403 }),
    };
  }

  const membership = await selectMembership(env, userId, activeWorkspaceId);
  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "Workspace membership is not active" }, { status: 403 }),
    };
  }

  const defaultWorkspace = await selectDefaultWorkspaceForAccount(env, accountId);
  if (!defaultWorkspace) {
    return {
      ok: false,
      response: json({ ok: false, error: "Default workspace not found" }, { status: 403 }),
    };
  }

  const agent = await selectDefaultAgent(env, activeWorkspaceId);
  if (!agent || agent.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "Active default agent not found" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    identity: {
      scope: { userId, workspaceId: activeWorkspaceId },
      agentId: agent.id,
      accountId,
      accountSource,
    },
  };
};
