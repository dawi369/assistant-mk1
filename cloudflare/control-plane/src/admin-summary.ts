import {
  getLatestChatIntent,
  getLatestChatPolicyDecision,
  getLatestChatSession,
  getLatestChatRun,
  toChatIntentSnapshot,
  toChatPolicyDecisionSnapshot,
  toChatRunSnapshot,
  toChatSessionSnapshot,
  toChatThreadSnapshot,
} from "./chat-boundary-store";
import { handleLatestControlPlaneEvents } from "./control-plane-events";
import { getControlRunSnapshot, readLatestControlRun } from "./demo-run-store";
import { json, parseDataJson, parseJson } from "./http";
import {
  selectAgent,
  selectAccountWorkspacesForUser,
  selectMembership,
  selectUser,
  selectWorkspace,
  selectWorkspaceAgents,
} from "./authz-store";
import type {
  AgentIdentity,
  AgentRow,
  ChatRunRow,
  ChatThreadRow,
  ControlPlaneEventRow,
  ControlRunRow,
  Env,
  TenantScope,
  WorkspaceRow,
} from "./types";

const authModeHeader = "x-assistant-mk1-auth-mode";
const workspaceSourceHeader = "x-assistant-mk1-workspace-source";
const membershipRoleHeader = "x-assistant-mk1-membership-role";
const membershipRolesHeader = "x-assistant-mk1-membership-roles";
const membershipPermissionsHeader = "x-assistant-mk1-membership-permissions";
const membershipStatusHeader = "x-assistant-mk1-membership-status";

const readOptionalHeader = (request: Request, name: string) =>
  request.headers.get(name)?.trim() || undefined;

const parseStringArray = (raw: string) => {
  const parsed = parseJson(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
};

const externalMembershipSummary = (request: Request) => {
  const role = readOptionalHeader(request, membershipRoleHeader);
  const roles = parseStringArray(readOptionalHeader(request, membershipRolesHeader) ?? "[]");
  const permissions = parseStringArray(
    readOptionalHeader(request, membershipPermissionsHeader) ?? "[]",
  );
  const status = readOptionalHeader(request, membershipStatusHeader);

  if (!role && roles.length === 0 && permissions.length === 0 && !status) return null;

  return {
    source: "workos-headers",
    role: role ?? null,
    status: status ?? null,
    roles,
    permissions,
  };
};

const toAgentSummary = (row: AgentRow) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  isDefault: row.is_default === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toWorkspaceSummary = (row: WorkspaceRow, activeWorkspaceId: string) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  isDefault: row.is_default === 1,
  isActive: row.id === activeWorkspaceId,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const latestThreadForSession = async (
  env: Env,
  scope: TenantScope,
  sessionId: string,
  activeThreadId?: string,
) => {
  if (activeThreadId) {
    const activeThread = await env.DB.prepare(
      `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
              created_at, updated_at, last_seen_at
       FROM chat_threads
       WHERE user_id = ? AND workspace_id = ? AND session_id = ? AND thread_id = ?
       LIMIT 1`,
    )
      .bind(scope.userId, scope.workspaceId, sessionId, activeThreadId)
      .first<ChatThreadRow>();
    if (activeThread) return activeThread;
  }

  return env.DB.prepare(
    `SELECT thread_id, session_id, user_id, workspace_id, agent_id, status, upstream_json,
            created_at, updated_at, last_seen_at
     FROM chat_threads
     WHERE user_id = ? AND workspace_id = ? AND session_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId, sessionId)
    .first<ChatThreadRow>();
};

const latestFailedChatRun = (env: Env, scope: TenantScope) =>
  env.DB.prepare(
    `SELECT id, intent_id, policy_decision_id, thread_id, user_id, workspace_id, agent_id,
            upstream_run_id, status, metadata_json, error, started_at, completed_at,
            failed_at, updated_at
     FROM chat_runs
     WHERE user_id = ? AND workspace_id = ? AND (status = 'failed' OR error IS NOT NULL)
     ORDER BY updated_at DESC, started_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId)
    .first<ChatRunRow>();

const latestFailedControlRun = (env: Env, scope: TenantScope) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, workflow_intent_id, status, execution_json,
            stage, engine, heartbeat_at, last_event_at, completed_at, failed_at, data_json,
            created_at, updated_at
     FROM control_runs
     WHERE user_id = ? AND workspace_id = ? AND status = 'failed'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId)
    .first<ControlRunRow>();

const latestErrorEvent = (env: Env, scope: TenantScope) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, type, summary, target_type, target_id,
            data_json, created_at
     FROM control_plane_events
     WHERE user_id = ? AND workspace_id = ? AND (type LIKE '%failed%' OR type LIKE '%error%')
     ORDER BY rowid DESC
     LIMIT 1`,
  )
    .bind(scope.userId, scope.workspaceId)
    .first<ControlPlaneEventRow>();

const newestError = (
  candidates: Array<{
    source: "chat" | "demo" | "event";
    message: string;
    status?: string;
    targetId?: string;
    createdAt?: string;
  } | null>,
) => {
  return (
    candidates
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((left, right) => {
        const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
        const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
        return rightTime - leftTime;
      })[0] ?? null
  );
};

export const handleAdminWorkspaceSummary = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  const [
    user,
    workspace,
    membership,
    agent,
    agents,
    accountWorkspaces,
    latestSession,
    latestDemoRun,
    events,
  ] = await Promise.all([
    selectUser(env, identity.scope.userId),
    selectWorkspace(env, identity.scope.workspaceId),
    selectMembership(env, identity.scope.userId, identity.scope.workspaceId),
    selectAgent(env, identity.agentId, identity.scope.workspaceId),
    selectWorkspaceAgents(env, identity.scope.workspaceId),
    identity.accountId
      ? selectAccountWorkspacesForUser(env, {
          userId: identity.scope.userId,
          accountId: identity.accountId,
        })
      : Promise.resolve({ results: [] }),
    getLatestChatSession(env, identity.scope),
    readLatestControlRun(env, identity.scope),
    handleLatestControlPlaneEvents(env, identity, new URL("https://internal/events?limit=12")),
  ]);

  const latestThread = latestSession
    ? await latestThreadForSession(
        env,
        identity.scope,
        latestSession.session_id,
        latestSession.active_thread_id ?? undefined,
      )
    : null;
  const [
    latestChatRun,
    latestIntent,
    latestPolicyDecision,
    failedChatRun,
    failedControlRun,
    errorEvent,
  ] = await Promise.all([
    latestThread ? getLatestChatRun(env, identity.scope, latestThread.thread_id) : null,
    latestThread ? getLatestChatIntent(env, identity.scope, latestThread.thread_id) : null,
    latestThread ? getLatestChatPolicyDecision(env, identity.scope, latestThread.thread_id) : null,
    latestFailedChatRun(env, identity.scope),
    latestFailedControlRun(env, identity.scope),
    latestErrorEvent(env, identity.scope),
  ]);

  const demoSnapshot = latestDemoRun
    ? await getControlRunSnapshot(env, identity.scope, latestDemoRun.id)
    : null;
  const failedControlData = failedControlRun ? parseDataJson(failedControlRun.data_json) : {};
  const lastError = newestError([
    failedChatRun
      ? {
          source: "chat",
          message: failedChatRun.error ?? "Chat run failed.",
          status: failedChatRun.status,
          targetId: failedChatRun.id,
          createdAt: failedChatRun.updated_at,
        }
      : null,
    failedControlRun
      ? {
          source: "demo",
          message:
            typeof failedControlData.error === "string"
              ? failedControlData.error
              : "Demo inspect run failed.",
          status: failedControlRun.status,
          targetId: failedControlRun.id,
          createdAt: failedControlRun.updated_at,
        }
      : null,
    errorEvent
      ? {
          source: "event",
          message: errorEvent.summary,
          targetId: errorEvent.target_id ?? errorEvent.id,
          createdAt: errorEvent.created_at,
        }
      : null,
  ]);

  return json({
    ok: true,
    summary: {
      generatedAt: new Date().toISOString(),
      identity: {
        userId: identity.scope.userId,
        workspaceId: identity.scope.workspaceId,
        agentId: identity.agentId,
        authMode: readOptionalHeader(request, authModeHeader) ?? "unknown",
        workspaceSource: readOptionalHeader(request, workspaceSourceHeader) ?? "unknown",
      },
      account: workspace
        ? {
            id: workspace.account_id,
            source: workspace.account_source,
          }
        : null,
      user: user
        ? {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            status: user.status,
          }
        : null,
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            status: workspace.status,
            isDefault: workspace.is_default === 1,
            isActive: true,
          }
        : null,
      workspaces: accountWorkspaces.results.map((accountWorkspace) =>
        toWorkspaceSummary(accountWorkspace, identity.scope.workspaceId),
      ),
      membership: membership
        ? {
            source: "cloudflare-d1",
            role: membership.role,
            status: membership.status,
            roles: parseStringArray(membership.roles_json),
            permissions: parseStringArray(membership.permissions_json),
          }
        : null,
      externalMembership: externalMembershipSummary(request),
      defaultAgent: agent ? toAgentSummary(agent) : null,
      agents: agents.results.map(toAgentSummary),
      chat: {
        latestSession: toChatSessionSnapshot(latestSession),
        latestThread: latestThread ? toChatThreadSnapshot(latestThread) : null,
        latestRun: toChatRunSnapshot(latestChatRun),
        latestIntent: toChatIntentSnapshot(latestIntent),
        latestPolicyDecision: toChatPolicyDecisionSnapshot(latestPolicyDecision),
      },
      demo: {
        latestRun: demoSnapshot,
      },
      events: events.events ?? [],
      lastError,
    },
  });
};
