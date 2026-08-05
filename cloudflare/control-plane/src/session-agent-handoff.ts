import { toAgentRuntimeMetadata } from "./agent-records";
import { upsertActiveAgentPreference } from "./authz";
import { selectAgent } from "./authz-store";
import { resolveThreadAgentInstanceName } from "./chat-agent-connection-context";
import {
  getLatestChatSession,
  getLatestRunningChatRun,
  getOwnedChatThread,
} from "./chat-boundary-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { parseDataJson } from "./http";
import {
  appendAgentHandoffToUpstream,
  buildSnapshot,
  normalizeAgentSwitchTarget,
  responseFromSnapshot,
} from "./session-agent-model";
import type {
  AgentHandoffSummary,
  CoordinatorRequest,
  SessionSnapshot,
} from "./session-agent-model";
import {
  agentHandoffTransition,
  safeAgentSwitchData,
  updateChatSessionAgent,
} from "./session-agent-transitions";
import type { WorkbenchSessionEventType } from "./session-event-types";
import { createId, toJson, type ChatThreadRow, type Env } from "./types";

type BroadcastSessionEvent = (
  type: WorkbenchSessionEventType,
  data: Record<string, unknown>,
) => void;

export const switchSessionAgent = async (input: {
  env: Env;
  request: CoordinatorRequest;
  snapshot: SessionSnapshot | null;
  nextRevision: () => number;
  broadcast: BroadcastSessionEvent;
}) => {
  const { env, request, nextRevision, broadcast } = input;
  const startedAt = new Date().toISOString();
  const agentId = request.agentSwitch?.agentId?.trim();
  const target = normalizeAgentSwitchTarget(request.agentSwitch?.target);
  if (!agentId) return { result: { ok: false, error: "agentId is required", status: 400 } };

  const targetAgent = await selectAgent(env, agentId, request.identity.scope.workspaceId);
  if (!targetAgent) return { result: { ok: false, error: "Agent not found", status: 404 } };
  if (targetAgent.status !== "active") {
    return { result: { ok: false, error: "Agent is not active", status: 403 } };
  }

  const activeIdentity = { ...request.identity, agentId: targetAgent.id };
  const latestSession = await getLatestChatSession(env, request.identity.scope);
  const activeThreadId =
    target === "current_thread"
      ? (request.threadId?.trim() ??
        input.snapshot?.activeThread?.threadId ??
        latestSession?.active_thread_id ??
        "")
      : "";

  if (target === "new_thread") {
    await upsertActiveAgentPreference(env, {
      userId: request.identity.scope.userId,
      workspaceId: request.identity.scope.workspaceId,
      agentId: targetAgent.id,
      reason: "agent-selected-new-thread",
    });
    if (latestSession?.session_id) {
      await updateChatSessionAgent(env, request.identity, {
        sessionId: latestSession.session_id,
        agentId: targetAgent.id,
        activeThreadId: null,
      });
    }
    const snapshot = await buildSnapshot(env, activeIdentity, {
      revision: nextRevision(),
      activeAgent: targetAgent,
    });
    broadcast("session.agent.handoff", safeAgentSwitchData(snapshot, { startedAt }));
    broadcast("admin.summary.invalidated", {
      reason: "agent-selected-new-thread",
      agentId: targetAgent.id,
    });
    return {
      snapshot,
      result: await responseFromSnapshot(env, request.agentHost!, snapshot, {
        partial: true,
        threadsRefreshRecommended: true,
        transition: agentHandoffTransition(startedAt),
        agentHandoff: null,
      }),
    };
  }

  if (!activeThreadId) {
    return { result: { ok: false, error: "No active thread to continue", status: 400 } };
  }
  const thread = await getOwnedChatThread(env, request.identity.scope, activeThreadId);
  if (!thread || thread.status !== "active") {
    return { result: { ok: false, error: "Thread not found", status: 404 } };
  }
  if (thread.agent_id === targetAgent.id) {
    const snapshot = await buildSnapshot(env, activeIdentity, {
      revision: nextRevision(),
      activeThread: thread,
      activeAgent: targetAgent,
    });
    return {
      snapshot,
      result: await responseFromSnapshot(env, request.agentHost!, snapshot, { partial: true }),
    };
  }
  const runningRun = await getLatestRunningChatRun(env, request.identity.scope, thread.thread_id);
  if (runningRun) {
    return { result: { ok: false, error: "Thread has a running chat response", status: 409 } };
  }
  await upsertActiveAgentPreference(env, {
    userId: request.identity.scope.userId,
    workspaceId: request.identity.scope.workspaceId,
    agentId: targetAgent.id,
    reason: "agent-handoff",
  });

  const fromAgent = await selectAgent(env, thread.agent_id, request.identity.scope.workspaceId);
  const handoff: AgentHandoffSummary = {
    id: createId("cf-agent-handoff"),
    threadId: thread.thread_id,
    fromAgentId: fromAgent?.id,
    fromAgentName: fromAgent?.name,
    toAgentId: targetAgent.id,
    toAgentName: targetAgent.name,
    target,
    createdAt: startedAt,
  };
  const upstream = appendAgentHandoffToUpstream(
    {
      ...parseDataJson(thread.upstream_json),
      instanceName: await resolveThreadAgentInstanceName(thread),
      agent: toAgentRuntimeMetadata(env, targetAgent, targetAgent.id),
    },
    handoff,
  );
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE chat_threads
       SET agent_id = ?, upstream_json = ?, updated_at = ?, last_seen_at = ?
       WHERE user_id = ? AND workspace_id = ? AND thread_id = ?`,
    ).bind(
      targetAgent.id,
      toJson(upstream),
      timestamp,
      timestamp,
      request.identity.scope.userId,
      request.identity.scope.workspaceId,
      thread.thread_id,
    ),
    env.DB.prepare(
      `UPDATE chat_sessions
       SET agent_id = ?, active_thread_id = ?, last_seen_at = ?, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
    ).bind(
      targetAgent.id,
      thread.thread_id,
      timestamp,
      timestamp,
      request.identity.scope.userId,
      request.identity.scope.workspaceId,
      thread.session_id,
    ),
  ]);

  const updatedThread: ChatThreadRow = {
    ...thread,
    agent_id: targetAgent.id,
    upstream_json: toJson(upstream),
    updated_at: timestamp,
    last_seen_at: timestamp,
  };
  const snapshot = await buildSnapshot(env, activeIdentity, {
    revision: nextRevision(),
    activeThread: updatedThread,
    activeAgent: targetAgent,
  });
  snapshot.agentHandoff = handoff;

  await appendControlPlaneEvent(env, activeIdentity, {
    type: "session.agent.handoff",
    summary: `Switched agent from ${fromAgent?.name ?? "Unknown agent"} to ${targetAgent.name}.`,
    targetType: "chat_thread",
    targetId: thread.thread_id,
    data: { agentHandoff: handoff },
  });
  broadcast(
    "session.agent.handoff",
    safeAgentSwitchData(snapshot, { startedAt, agentHandoff: handoff }),
  );
  broadcast("admin.summary.invalidated", {
    reason: "agent-handoff",
    threadId: thread.thread_id,
    agentId: targetAgent.id,
  });
  return {
    snapshot,
    result: await responseFromSnapshot(env, request.agentHost!, snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: agentHandoffTransition(startedAt),
      agentHandoff: handoff,
    }),
  };
};
