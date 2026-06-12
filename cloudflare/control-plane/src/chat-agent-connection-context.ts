import { toAgentRuntimeMetadata } from "./agent-records";
import { selectAgent } from "./authz-store";
import {
  createChatSession,
  getLatestChatSession,
  getOwnedChatThread,
  storeChatThread,
  touchChatSession,
} from "./chat-boundary-store";
import { recordSpan, startTrace, finishTrace } from "./runtime-traces";
import { createId, type AgentIdentity, type Env } from "./types";

const encoder = new TextEncoder();

const sha256Hex = async (value: string) => {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const deriveThreadAgentInstanceName = async (input: {
  userId: string;
  workspaceId: string;
  agentId: string;
  threadId: string;
}) => {
  const hash = await sha256Hex(
    `${input.userId}:${input.workspaceId}:${input.agentId}:${input.threadId}`,
  );
  return `thread-${hash.slice(0, 48)}`;
};

export const getOrCreateThreadAgentConnectionContext = async (
  env: Env,
  identity: AgentIdentity,
  options?: { fresh?: boolean; threadId?: string; traceId?: string },
) => {
  const requestedThreadId = options?.threadId?.trim();
  const trace = await startTrace(env, identity, {
    traceId: options?.traceId,
    kind: "chat.thread.create",
    rootName: options?.fresh
      ? "Create new Agent chat thread"
      : requestedThreadId
        ? "Switch Agent chat thread"
        : "Resolve Agent chat thread",
    summary: options?.fresh
      ? "New Agent chat thread requested."
      : requestedThreadId
        ? "Existing Agent chat thread requested."
        : "Agent chat thread resolved.",
    data: { runtime: "cloudflare-agent-chat" },
  });

  const sessionStartedAtMs = Date.now();
  const requestedThread =
    requestedThreadId && !options?.fresh
      ? await getOwnedChatThread(env, identity.scope, requestedThreadId)
      : null;
  if (requestedThreadId && (!requestedThread || requestedThread.agent_id !== identity.agentId)) {
    await finishTrace(env, identity, trace, {
      status: "failed",
      summary: "Requested Agent chat thread was not found for this workspace and agent.",
      data: { runtime: "cloudflare-agent-chat", threadId: requestedThreadId },
    });
    return null;
  }

  const latestSession =
    options?.fresh || requestedThread ? null : await getLatestChatSession(env, identity.scope);
  const sessionId =
    requestedThread?.session_id ??
    latestSession?.session_id ??
    (await createChatSession(env, identity, { source: "cloudflare-agent-chat" }));
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Resolve chat session",
    layer: "d1",
    startedAtMs: sessionStartedAtMs,
    endedAtMs: Date.now(),
    data: {
      fresh: Boolean(options?.fresh),
      requestedThread: Boolean(requestedThread),
      reused: Boolean(requestedThread || latestSession),
    },
  });

  const candidateThreadId = latestSession?.active_thread_id ?? null;
  const ownedThread = candidateThreadId
    ? await getOwnedChatThread(env, identity.scope, candidateThreadId)
    : null;
  const threadId =
    requestedThread?.thread_id ??
    (options?.fresh || !ownedThread ? createId("cf-thread") : ownedThread.thread_id);

  const activeAgent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const agentMetadata = toAgentRuntimeMetadata(env, activeAgent, identity.agentId);
  const instanceName = await deriveThreadAgentInstanceName({
    userId: identity.scope.userId,
    workspaceId: identity.scope.workspaceId,
    agentId: identity.agentId,
    threadId,
  });

  const threadStartedAtMs = Date.now();
  if (!requestedThread) {
    await storeChatThread(env, identity, sessionId, threadId, {
      source: "cloudflare-agent-chat",
      runtime: "cloudflare-agent-chat",
      threadId,
      instanceName,
      agent: agentMetadata,
    });
  }
  await touchChatSession(env, identity.scope, sessionId, threadId);
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Activate Agent chat thread",
    layer: "d1",
    startedAtMs: threadStartedAtMs,
    endedAtMs: Date.now(),
    data: { threadId, sessionId, instanceName },
  });

  await finishTrace(env, identity, trace, {
    status: "completed",
    summary: options?.fresh
      ? "New Agent chat thread activated."
      : requestedThread
        ? "Existing Agent chat thread activated."
        : "Agent chat thread ready.",
    data: { runtime: "cloudflare-agent-chat", threadId, sessionId, instanceName },
  });

  return {
    agentName: "workbench-thread-chat-agent",
    instanceName,
    threadId,
    sessionId,
    workspaceId: identity.scope.workspaceId,
    agentId: identity.agentId,
    agentUpdatedAt: activeAgent?.updated_at,
    accountId: identity.accountId,
    accountSource: identity.accountSource,
  };
};
