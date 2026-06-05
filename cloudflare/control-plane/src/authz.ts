import {
  agentIdHeader,
  json,
  parseJson,
  readRequiredHeader,
  userIdHeader,
  workspaceIdHeader,
} from "./http";
import {
  createId,
  toJson,
  type AgentIdentity,
  type AgentRow,
  type Env,
  type MembershipRow,
  type UserRow,
  type WorkspaceRow,
} from "./types";

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

const defaultAgentId = (workspaceId: string) => `agent-${workspaceId}`;

const selectUser = (env: Env, userId: string) =>
  env.DB.prepare(
    `SELECT id, email, display_name, status, data_json, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first<UserRow>();

const selectWorkspace = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, name, status, created_by_user_id, data_json, created_at, updated_at
     FROM workspaces
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first<WorkspaceRow>();

const selectMembership = (env: Env, userId: string, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, role, status, roles_json, permissions_json,
            data_json, created_at, updated_at
     FROM memberships
     WHERE user_id = ? AND workspace_id = ?
     LIMIT 1`,
  )
    .bind(userId, workspaceId)
    .first<MembershipRow>();

const selectDefaultAgent = (env: Env, workspaceId: string) =>
  env.DB.prepare(
    `SELECT id, workspace_id, name, description, status, is_default, created_by_user_id,
            data_json, created_at, updated_at
     FROM agents
     WHERE workspace_id = ? AND is_default = 1
     LIMIT 1`,
  )
    .bind(workspaceId)
    .first<AgentRow>();

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

const upsertWorkspace = async (
  env: Env,
  input: { workspaceId: string; userId: string; name?: string; status?: string },
) => {
  const timestamp = new Date().toISOString();
  const name = input.name ?? input.workspaceId;
  const status = input.status ?? "active";
  await env.DB.prepare(
    `INSERT INTO workspaces (
       id, name, status, created_by_user_id, data_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = COALESCE(excluded.name, workspaces.name),
       updated_at = excluded.updated_at`,
  )
    .bind(
      input.workspaceId,
      name,
      status,
      input.userId,
      toJson({ provider: "workos" }),
      timestamp,
      timestamp,
    )
    .run();
};

const upsertMembership = async (
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
       role = excluded.role,
       roles_json = excluded.roles_json,
       permissions_json = excluded.permissions_json,
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

const createDefaultAgentIfMissing = async (
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

const bootstrapAuthz = async (
  env: Env,
  request: Request,
  input: { userId: string; workspaceId: string },
) => {
  const email = readOptionalHeader(request, userEmailHeader);
  const displayName = readOptionalHeader(request, userNameHeader) ?? email;
  const role =
    firstPresent(readOptionalHeader(request, membershipRoleHeader), "member") ?? "member";
  const roles = parseStringArrayHeader(readOptionalHeader(request, membershipRolesHeader));
  const permissions = parseStringArrayHeader(
    readOptionalHeader(request, membershipPermissionsHeader),
  );
  const membershipStatus = readOptionalHeader(request, membershipStatusHeader);
  const workspaceStatus = readOptionalHeader(request, workspaceStatusHeader);

  await upsertUser(env, { userId: input.userId, email, displayName });
  await upsertWorkspace(env, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    name: readOptionalHeader(request, workspaceNameHeader),
    status: workspaceStatus,
  });
  await upsertMembership(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
    role,
    roles,
    permissions,
    status: membershipStatus,
  });
  await createDefaultAgentIfMissing(env, {
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
};

export const resolveAgentIdentity = async (request: Request, env: Env): Promise<ResolveResult> => {
  const userId = readRequiredHeader(request, userIdHeader);
  const workspaceId = readRequiredHeader(request, workspaceIdHeader);
  const explicitAgentId = readRequiredHeader(request, agentIdHeader);

  if (!userId || !workspaceId) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "x-assistant-mk1-user-id and x-assistant-mk1-workspace-id are required",
        },
        { status: 400 },
      ),
    };
  }

  if (explicitAgentId) {
    return {
      ok: true,
      identity: {
        scope: { userId, workspaceId },
        agentId: explicitAgentId,
      },
    };
  }

  await bootstrapAuthz(env, request, { userId, workspaceId });

  const user = await selectUser(env, userId);
  if (!user || user.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "User is not active" }, { status: 403 }),
    };
  }

  const workspace = await selectWorkspace(env, workspaceId);
  if (!workspace || workspace.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "Workspace is not active" }, { status: 403 }),
    };
  }

  const membership = await selectMembership(env, userId, workspaceId);
  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "Workspace membership is not active" }, { status: 403 }),
    };
  }

  const agent = await selectDefaultAgent(env, workspaceId);
  if (!agent || agent.status !== "active") {
    return {
      ok: false,
      response: json({ ok: false, error: "Active default agent not found" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    identity: {
      scope: { userId, workspaceId },
      agentId: agent.id,
    },
  };
};
