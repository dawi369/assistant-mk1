import {
  countActiveWorkspaceOwners,
  selectDefaultWorkspaceForAccount,
  selectMembership,
  selectUser,
  selectWorkspace,
  selectWorkspaceMemberships,
} from "./authz-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { appendControlAudit } from "./demo-run-store";
import { isRecord, json, parseJson } from "./http";
import {
  evaluateMembershipUpdate,
  requireAdminMembership,
  workspaceMembershipRoles,
  workspaceMembershipStatuses,
  type WorkspaceMembershipRole,
  type WorkspaceMembershipStatus,
} from "./membership-policy";
import {
  toJson,
  type AgentIdentity,
  type D1Result,
  type Env,
  type MembershipRow,
  type WorkspaceRow,
} from "./types";

const isMembershipRole = (value: unknown): value is WorkspaceMembershipRole =>
  typeof value === "string" && workspaceMembershipRoles.includes(value as WorkspaceMembershipRole);

const isMembershipStatus = (value: unknown): value is WorkspaceMembershipStatus =>
  typeof value === "string" &&
  workspaceMembershipStatuses.includes(value as WorkspaceMembershipStatus);

const parseStringArray = (raw: string) => {
  const parsed = parseJson(raw || "[]");
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

const toMembershipSummary = (
  row: MembershipRow & {
    email?: string | null;
    display_name?: string | null;
    user_status?: string | null;
  },
  actorUserId: string,
) => ({
  id: row.id,
  userId: row.user_id,
  email: row.email ?? undefined,
  displayName: row.display_name ?? row.email ?? row.user_id,
  role: row.role,
  roles: parseStringArray(row.roles_json),
  permissions: parseStringArray(row.permissions_json),
  status: row.status,
  userStatus: row.user_status ?? undefined,
  isCurrentUser: row.user_id === actorUserId,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

type MembershipWithUser = MembershipRow & {
  email?: string | null;
  display_name?: string | null;
  user_status?: string | null;
};

const eligibleAccountMembers = async (
  env: Env,
  workspace: WorkspaceRow,
  currentMemberships: MembershipWithUser[],
  actorUserId: string,
) => {
  const defaultWorkspace = await selectDefaultWorkspaceForAccount(env, workspace.account_id);
  if (!defaultWorkspace || defaultWorkspace.id === workspace.id) return [];
  const accountMemberships = await selectWorkspaceMemberships(env, defaultWorkspace.id);
  const currentUserIds = new Set(currentMemberships.map((membership) => membership.user_id));
  return accountMemberships.results
    .filter(
      (membership) =>
        membership.status === "active" &&
        membership.user_status === "active" &&
        !currentUserIds.has(membership.user_id),
    )
    .map((membership) => toMembershipSummary(membership, actorUserId));
};

const requireActiveWorkspace = async (env: Env, identity: AgentIdentity, workspaceId: string) => {
  if (workspaceId !== identity.scope.workspaceId) {
    return {
      ok: false as const,
      response: json({ ok: false, error: "Workspace not found" }, { status: 404 }),
    };
  }
  const workspace = await selectWorkspace(env, workspaceId);
  if (!workspace || workspace.status !== "active") {
    return {
      ok: false as const,
      response: json({ ok: false, error: "Workspace not found" }, { status: 404 }),
    };
  }
  return { ok: true as const, workspace };
};

export const handleListWorkspaceMembers = async (
  env: Env,
  identity: AgentIdentity,
  workspaceId: string,
) => {
  const workspaceResult = await requireActiveWorkspace(env, identity, workspaceId);
  if (!workspaceResult.ok) return workspaceResult.response;

  const actor = await selectMembership(env, identity.scope.userId, workspaceId);
  const adminError = requireAdminMembership(actor);
  if (adminError) return adminError;

  const memberships = await selectWorkspaceMemberships(env, workspaceId);
  const availableMembers = await eligibleAccountMembers(
    env,
    workspaceResult.workspace,
    memberships.results,
    identity.scope.userId,
  );
  return json({
    ok: true,
    workspace: {
      id: workspaceResult.workspace.id,
      name: workspaceResult.workspace.name,
    },
    currentMembership: actor ? toMembershipSummary(actor, identity.scope.userId) : null,
    members: memberships.results.map((membership) =>
      toMembershipSummary(membership, identity.scope.userId),
    ),
    availableMembers,
  });
};

export const handleAddWorkspaceMember = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  workspaceId: string,
) => {
  const workspaceResult = await requireActiveWorkspace(env, identity, workspaceId);
  if (!workspaceResult.ok) return workspaceResult.response;

  const actor = await selectMembership(env, identity.scope.userId, workspaceId);
  const adminError = requireAdminMembership(actor);
  if (adminError) return adminError;
  if (!actor)
    return json({ ok: false, error: "Workspace membership is not active" }, { status: 403 });

  const body = parseJson(await request.text());
  const userId = isRecord(body) && typeof body.userId === "string" ? body.userId.trim() : "";
  const role = isRecord(body) && isMembershipRole(body.role) ? body.role : undefined;
  if (!userId || !role) {
    return json(
      { ok: false, error: "A valid account member and role are required" },
      { status: 400 },
    );
  }
  if (actor.role.toLowerCase() === "admin" && role !== "member") {
    return json(
      { ok: false, error: "Workspace admins can only add members with the member role" },
      { status: 403 },
    );
  }
  if (await selectMembership(env, userId, workspaceId)) {
    return json({ ok: false, error: "User is already a workspace member" }, { status: 409 });
  }

  const defaultWorkspace = await selectDefaultWorkspaceForAccount(
    env,
    workspaceResult.workspace.account_id,
  );
  const [accountMembership, accountUser] = await Promise.all([
    defaultWorkspace ? selectMembership(env, userId, defaultWorkspace.id) : null,
    selectUser(env, userId),
  ]);
  if (
    !accountMembership ||
    accountMembership.status !== "active" ||
    !accountUser ||
    accountUser.status !== "active"
  ) {
    return json({ ok: false, error: "Active account member not found" }, { status: 404 });
  }

  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO memberships (
       id, user_id, workspace_id, role, status, roles_json, permissions_json, data_json,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      workspaceId,
      role,
      toJson([role]),
      accountMembership.permissions_json,
      toJson({ source: "workspace-admin", addedByUserId: identity.scope.userId }),
      timestamp,
      timestamp,
    )
    .run();

  const summary = `Added ${userId} to ${workspaceResult.workspace.name}.`;
  await appendControlAudit(env, {
    ...identity,
    action: "membership.created",
    summary,
    targetType: "user",
    targetId: userId,
    data: { targetUserId: userId, role },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "membership.created",
    summary,
    targetType: "user",
    targetId: userId,
    data: { targetUserId: userId, role },
  });

  return json({ ok: true, userId, role, status: "active" }, { status: 201 });
};

export const handleUpdateWorkspaceMember = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  workspaceId: string,
  targetUserId: string,
) => {
  const workspaceResult = await requireActiveWorkspace(env, identity, workspaceId);
  if (!workspaceResult.ok) return workspaceResult.response;

  const [actor, target, ownerCount] = await Promise.all([
    selectMembership(env, identity.scope.userId, workspaceId),
    selectMembership(env, targetUserId, workspaceId),
    countActiveWorkspaceOwners(env, workspaceId),
  ]);
  const adminError = requireAdminMembership(actor);
  if (adminError) return adminError;
  if (!actor || !target) {
    return json({ ok: false, error: "Workspace member not found" }, { status: 404 });
  }

  const body = parseJson(await request.text());
  const role = isRecord(body) && isMembershipRole(body.role) ? body.role : undefined;
  const status = isRecord(body) && isMembershipStatus(body.status) ? body.status : undefined;
  if (!role || !status) {
    return json(
      { ok: false, error: "A valid membership role and status are required" },
      { status: 400 },
    );
  }

  const decision = evaluateMembershipUpdate({
    actor,
    target,
    role,
    status,
    activeOwnerCount: ownerCount?.count ?? 0,
  });
  if (!decision.ok) return json({ ok: false, error: decision.error }, { status: 403 });

  const timestamp = new Date().toISOString();
  const updateResult = (await env.DB.prepare(
    `UPDATE memberships
     SET role = ?, status = ?, roles_json = ?, data_json = ?, updated_at = ?
     WHERE user_id = ? AND workspace_id = ?
       AND (
         lower(role) != 'owner'
         OR status != 'active'
         OR (? = 'owner' AND ? = 'active')
         OR (
           SELECT COUNT(*)
           FROM memberships AS owners
           WHERE owners.workspace_id = memberships.workspace_id
             AND owners.status = 'active'
             AND lower(owners.role) = 'owner'
         ) > 1
       )`,
  )
    .bind(
      role,
      status,
      toJson([role]),
      toJson({
        source: "workspace-admin",
        changedByUserId: identity.scope.userId,
      }),
      timestamp,
      targetUserId,
      workspaceId,
      role,
      status,
    )
    .run()) as D1Result;
  if (updateResult.meta?.changes === 0) {
    return json(
      { ok: false, error: "Workspace owner state changed; refresh and try again" },
      { status: 409 },
    );
  }

  const summary = `Updated workspace access for ${targetUserId}.`;
  await appendControlAudit(env, {
    ...identity,
    action: "membership.updated",
    summary,
    targetType: "membership",
    targetId: target.id,
    data: {
      targetUserId,
      previousRole: target.role,
      previousStatus: target.status,
      role,
      status,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "membership.updated",
    summary,
    targetType: "membership",
    targetId: target.id,
    data: { targetUserId, role, status },
  });

  return json({
    ok: true,
    member: toMembershipSummary(
      { ...target, role, status, roles_json: toJson([role]), updated_at: timestamp },
      identity.scope.userId,
    ),
  });
};
