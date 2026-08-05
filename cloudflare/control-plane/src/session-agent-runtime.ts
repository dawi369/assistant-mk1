import { toAgentSummary, toAgentRuntimeMetadata } from "./agent-records";
import { upsertActiveAgentPreference } from "./authz";
import { selectAgent } from "./authz-store";
import { resolveThreadAgentInstanceName } from "./chat-agent-connection-context";
import {
  createChatSession,
  getLatestChatSession,
  getLatestRunningChatRun,
  getOwnedChatThread,
  touchChatSession,
} from "./chat-boundary-store";
import { appendControlPlaneEvent } from "./control-plane-events";
import { parseDataJson } from "./http";
import { handleSessionAgentRequest } from "./session-agent-router";
import { createSessionEventStream } from "./session-agent-stream";
import type { WorkbenchSessionEvent, WorkbenchSessionEventType } from "./session-event-types";
import { createId, toJson, type AgentRow, type ChatThreadRow, type Env } from "./types";
import {
  appendAgentHandoffToUpstream,
  buildSnapshot,
  createThreadContext,
  listWorkspaceThreads,
  maxMaterializeTurnMessageLength,
  mergeActiveThread,
  normalizeAgentSwitchTarget,
  normalizeMaterializeMessage,
  responseFromSnapshot,
  sessionContext,
  sseEncoder,
  stagedThreadTtlMs,
  toActiveThreadSummary,
  toThreadSummary,
  workspaceSummary,
} from "./session-agent-model";
import type {
  AgentHandoffSummary,
  CoordinatorRequest,
  SessionSnapshot,
} from "./session-agent-model";
import {
  abortThreadChatResponse,
  agentHandoffTransition,
  appendThreadLifecycleEvent,
  clearActiveThread,
  draftExpiryFromThread,
  encodeSse,
  findFallbackActiveThread,
  findReusableDraftThread,
  materializeDraftThread,
  persistThreadMutation,
  safeAgentSwitchData,
  safeSnapshotData,
  safeThreadData,
  submitProgrammaticTurn,
  titleFromUpdate,
  transitionForStatus,
  updateChatSessionAgent,
} from "./session-agent-transitions";

export class WorkbenchSessionAgent {
  private snapshot: SessionSnapshot | null = null;
  private revision = 0;
  private clients = new Map<string, ReadableStreamDefaultController<Uint8Array>>();

  constructor(
    _state: unknown,
    private readonly env: Env,
  ) {}

  private nextRevision = () => (this.revision += 1);

  private createEvent(
    type: WorkbenchSessionEventType,
    data: Record<string, unknown>,
    input?: { id?: string; createdAt?: string; revision?: number },
  ): WorkbenchSessionEvent {
    return {
      id: input?.id ?? createId("cf-session-event"),
      type,
      revision: input?.revision ?? this.snapshot?.revision,
      createdAt: input?.createdAt ?? new Date().toISOString(),
      data,
    };
  }

  private sendEvent(
    controller: ReadableStreamDefaultController<Uint8Array>,
    event: WorkbenchSessionEvent,
  ) {
    controller.enqueue(sseEncoder.encode(encodeSse(event)));
  }

  private broadcastEvent(event: WorkbenchSessionEvent) {
    for (const [clientId, controller] of this.clients) {
      try {
        this.sendEvent(controller, event);
      } catch {
        this.clients.delete(clientId);
      }
    }
  }

  private async ensureSnapshot(input: CoordinatorRequest) {
    if (!this.snapshot) {
      this.snapshot = await buildSnapshot(this.env, input.identity, {
        revision: this.nextRevision(),
      });
    }
    return this.snapshot;
  }

  private async activeIdentity(input: CoordinatorRequest) {
    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    const agentId =
      this.snapshot?.activeAgent?.id ?? latestSession?.agent_id ?? input.identity.agentId;
    return {
      identity: { ...input.identity, agentId },
      latestSession,
    };
  }

  async getSession(input: CoordinatorRequest) {
    if (!this.snapshot || input.refresh === "threads") {
      const active = await this.activeIdentity(input);
      this.snapshot = await buildSnapshot(this.env, active.identity, {
        revision: this.nextRevision(),
      });
      if (input.refresh === "threads") {
        this.broadcastEvent(
          this.createEvent("session.threads.refreshed", safeSnapshotData(this.snapshot)),
        );
      }
    }
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: false,
      transition: { type: input.refresh === "threads" ? "initial" : "token_refresh" },
    });
  }

  async listThreads(input: CoordinatorRequest) {
    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    return {
      ok: true,
      threads: await listWorkspaceThreads(
        this.env,
        input.identity,
        latestSession?.active_thread_id ?? undefined,
        input.status === "archived" ? "archived" : "active",
      ),
    };
  }

  async createThread(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const active = await this.activeIdentity(input);
    const sessionId =
      this.snapshot?.context?.sessionId ??
      active.latestSession?.session_id ??
      (await createChatSession(this.env, active.identity, { source: "cloudflare-agent-chat" }));
    const created = await createThreadContext(this.env, active.identity, sessionId, input.title);
    const activeIdentity = { ...active.identity, agentId: created.activeAgent.id };
    const activeThread = toActiveThreadSummary(
      this.env,
      created.thread,
      created.activeAgent,
      created.thread.thread_id,
    );
    const context = await sessionContext(activeIdentity, {
      thread: created.thread,
      agent: created.activeAgent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, created.activeAgent, created.activeAgent.id),
      activeThread,
      threads: mergeActiveThread(this.snapshot?.threads ?? [], activeThread),
    };
    await appendThreadLifecycleEvent(this.env, activeIdentity, {
      transition: "create",
      threadId: activeThread.threadId,
      activeThreadId: activeThread.threadId,
      nextStatus: activeThread.status,
    });
    this.broadcastEvent(
      this.createEvent("session.thread.created", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "create", startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "thread-created",
        threadId: activeThread.threadId,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "create", startedAt },
    });
  }

  async stageThread(input: CoordinatorRequest) {
    const active = await this.activeIdentity(input);
    const latestSession = active.latestSession;
    const sessionId =
      this.snapshot?.context?.sessionId ??
      latestSession?.session_id ??
      (await createChatSession(this.env, active.identity, { source: "cloudflare-agent-chat" }));
    const reusable = await findReusableDraftThread(
      this.env,
      active.identity,
      sessionId,
      this.snapshot?.context?.threadId,
      latestSession?.active_thread_id,
    );
    const draftExpiresAt = reusable
      ? draftExpiryFromThread(reusable)
      : new Date(Date.now() + stagedThreadTtlMs).toISOString();
    const created = reusable
      ? {
          activeAgent: await selectAgent(
            this.env,
            reusable.agent_id,
            input.identity.scope.workspaceId,
          ),
          thread: reusable,
        }
      : await createThreadContext(this.env, active.identity, sessionId, "New chat", {
          status: "draft",
          draftExpiresAt,
        });

    if (!created.activeAgent || created.activeAgent.status !== "active") {
      throw new Error("Agent is not active");
    }

    const activeIdentity = { ...active.identity, agentId: created.activeAgent.id };
    const activeThread = toActiveThreadSummary(
      this.env,
      created.thread,
      created.activeAgent,
      created.thread.thread_id,
    );
    const context = await sessionContext(activeIdentity, {
      thread: created.thread,
      agent: created.activeAgent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, created.activeAgent, created.activeAgent.id),
      activeThread,
      threads: (this.snapshot?.threads ?? [])
        .filter((thread) => thread.threadId !== activeThread.threadId)
        .map((thread) => ({ ...thread, isActive: false })),
    };

    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      stagedThread: {
        threadId: activeThread.threadId,
        sessionId: activeThread.sessionId,
        expiresAt: draftExpiresAt,
        status: "draft",
      },
    });
  }

  async materializeTurn(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const message = normalizeMaterializeMessage(input.message);
    if (!message) {
      return {
        ok: false,
        error: `message must be non-empty text under ${maxMaterializeTurnMessageLength} characters`,
        status: 400,
      };
    }

    const active = await this.activeIdentity(input);
    const sessionId =
      this.snapshot?.context?.sessionId ??
      active.latestSession?.session_id ??
      (await createChatSession(this.env, active.identity, { source: "cloudflare-agent-chat" }));
    const reusable = await findReusableDraftThread(
      this.env,
      active.identity,
      sessionId,
      this.snapshot?.context?.threadId,
      active.latestSession?.active_thread_id,
    );
    const created = reusable
      ? await materializeDraftThread(this.env, input.identity, reusable, message)
      : await createThreadContext(this.env, active.identity, sessionId, message);
    const activeIdentity = { ...active.identity, agentId: created.activeAgent.id };
    const activeThread = toActiveThreadSummary(
      this.env,
      created.thread,
      created.activeAgent,
      created.thread.thread_id,
    );
    const context = await sessionContext(activeIdentity, {
      thread: created.thread,
      agent: created.activeAgent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, created.activeAgent, created.activeAgent.id),
      activeThread,
      threads: mergeActiveThread(this.snapshot?.threads ?? [], activeThread),
    };

    const response = await responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "create", startedAt },
      materializedTurn: { threadId: activeThread.threadId, status: "accepted" },
    });
    const token = response.connection?.token;
    if (!token) {
      return { ok: false, error: "Materialized Agent connection token was missing", status: 500 };
    }
    const submitted = await submitProgrammaticTurn(this.env, { context, token, message });
    if (!submitted.ok) {
      return {
        ok: false,
        error: submitted.error,
        status: submitted.status,
      };
    }
    response.materializedTurn = {
      threadId: activeThread.threadId,
      status: "accepted",
      messageId: submitted.messageId,
    };

    await appendThreadLifecycleEvent(this.env, activeIdentity, {
      transition: "create",
      threadId: activeThread.threadId,
      activeThreadId: activeThread.threadId,
      nextStatus: activeThread.status,
    });
    this.broadcastEvent(
      this.createEvent("session.thread.created", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "create", startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "thread-created",
        threadId: activeThread.threadId,
      }),
    );

    return response;
  }

  async updateThread(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const threadId = input.threadId?.trim();
    if (!threadId) return { ok: false, error: "threadId is required", status: 400 };
    if (input.update?.title === undefined && !input.update?.status) {
      return { ok: false, error: "title or status is required", status: 400 };
    }

    const thread = await getOwnedChatThread(this.env, input.identity.scope, threadId);
    if (!thread || thread.status === "deleted") {
      return { ok: false, error: "Thread not found", status: 404 };
    }

    const nextTitle = titleFromUpdate(input.update.title);
    if (nextTitle === null) return { ok: false, error: "title cannot be empty", status: 400 };

    const nextStatus = input.update.status;
    await persistThreadMutation(this.env, input.identity, thread, {
      title: nextTitle,
      status: nextStatus,
    });
    if (nextStatus === "archived" || nextStatus === "deleted") {
      await abortThreadChatResponse(this.env, thread);
    }

    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    const deactivatedActiveThread =
      latestSession?.active_thread_id === threadId &&
      (nextStatus === "archived" || nextStatus === "deleted");
    let snapshotIdentity = input.identity;
    let activeThread: ChatThreadRow | undefined;
    let activeAgent: AgentRow | undefined;

    if (deactivatedActiveThread) {
      const fallback = await findFallbackActiveThread(this.env, input.identity, threadId);
      if (fallback) {
        const fallbackAgent = await selectAgent(
          this.env,
          fallback.agent_id,
          input.identity.scope.workspaceId,
        );
        if (!fallbackAgent || fallbackAgent.status !== "active") {
          throw new Error("Agent is not active");
        }
        await upsertActiveAgentPreference(this.env, {
          userId: input.identity.scope.userId,
          workspaceId: input.identity.scope.workspaceId,
          agentId: fallbackAgent.id,
          reason: "thread-lifecycle-fallback",
        });
        await touchChatSession(
          this.env,
          input.identity.scope,
          fallback.session_id,
          fallback.thread_id,
        );
        snapshotIdentity = { ...input.identity, agentId: fallbackAgent.id };
        activeThread = fallback;
        activeAgent = fallbackAgent;
      } else {
        if (latestSession?.session_id) {
          await clearActiveThread(this.env, input.identity, latestSession.session_id);
        }
      }
    }

    this.snapshot = await buildSnapshot(this.env, snapshotIdentity, {
      revision: this.nextRevision(),
      activeThread,
      activeAgent,
    });
    const updatedThread =
      (await getOwnedChatThread(this.env, input.identity.scope, threadId)) ?? thread;
    const updatedAgent =
      (await selectAgent(this.env, updatedThread.agent_id, input.identity.scope.workspaceId)) ??
      activeAgent;
    const activeThreadId = this.snapshot.context?.threadId ?? null;
    const activeAgentId = this.snapshot.context?.agentId ?? this.snapshot.activeAgent.id;
    const summarizedThread = updatedAgent
      ? toActiveThreadSummary(this.env, updatedThread, updatedAgent, activeThreadId ?? "")
      : toThreadSummary(this.env, updatedThread, {
          activeThreadId,
          activeAgentId,
        });
    const transition = nextStatus ? transitionForStatus(nextStatus) : "rename";
    await appendThreadLifecycleEvent(this.env, snapshotIdentity, {
      transition,
      threadId,
      activeThreadId: activeThreadId ?? undefined,
      replacementThreadId: deactivatedActiveThread ? (activeThreadId ?? undefined) : undefined,
      previousStatus: thread.status,
      nextStatus: updatedThread.status,
    });

    this.broadcastEvent(
      this.createEvent("session.thread.updated", {
        ...safeThreadData(this.snapshot, summarizedThread),
        transition: { type: transition, startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: `thread-${transition}`,
        threadId,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: transition, startedAt },
    });
  }

  async activateThread(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const threadId = input.threadId?.trim();
    if (!threadId) return { ok: false, error: "threadId is required" };

    const thread = await getOwnedChatThread(this.env, input.identity.scope, threadId);
    if (!thread || thread.status !== "active") {
      return { ok: false, error: "Thread not found", status: 404 };
    }

    const agent = await selectAgent(this.env, thread.agent_id, input.identity.scope.workspaceId);
    if (!agent) return { ok: false, error: "Thread not found", status: 404 };
    if (agent.status !== "active") return { ok: false, error: "Agent is not active", status: 403 };

    await upsertActiveAgentPreference(this.env, {
      userId: input.identity.scope.userId,
      workspaceId: input.identity.scope.workspaceId,
      agentId: agent.id,
      reason: "thread-activated",
    });
    await touchChatSession(this.env, input.identity.scope, thread.session_id, thread.thread_id);

    const activeIdentity = { ...input.identity, agentId: agent.id };
    const activeThread = toActiveThreadSummary(this.env, thread, agent, thread.thread_id);
    const context = await sessionContext(activeIdentity, {
      thread,
      agent,
      accountId: input.identity.accountId,
      accountSource: input.identity.accountSource,
    });
    this.snapshot = {
      revision: this.nextRevision(),
      context,
      workspace:
        this.snapshot?.workspace ??
        (await workspaceSummary(this.env, input.identity.scope.workspaceId)),
      activeAgent: toAgentSummary(this.env, agent, agent.id),
      activeThread,
      threads: mergeActiveThread(this.snapshot?.threads ?? [], activeThread),
    };
    await appendThreadLifecycleEvent(this.env, activeIdentity, {
      transition: "activate",
      threadId: activeThread.threadId,
      activeThreadId: activeThread.threadId,
      nextStatus: activeThread.status,
    });
    this.broadcastEvent(
      this.createEvent("session.thread.activated", {
        ...safeSnapshotData(this.snapshot),
        transition: { type: "activate", startedAt },
      }),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "thread-activated",
        threadId: activeThread.threadId,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: { type: "activate", startedAt },
    });
  }

  async switchAgent(input: CoordinatorRequest) {
    const startedAt = new Date().toISOString();
    const agentId = input.agentSwitch?.agentId?.trim();
    const target = normalizeAgentSwitchTarget(input.agentSwitch?.target);
    if (!agentId) return { ok: false, error: "agentId is required", status: 400 };

    const targetAgent = await selectAgent(this.env, agentId, input.identity.scope.workspaceId);
    if (!targetAgent) return { ok: false, error: "Agent not found", status: 404 };
    if (targetAgent.status !== "active") {
      return { ok: false, error: "Agent is not active", status: 403 };
    }

    const activeIdentity = { ...input.identity, agentId: targetAgent.id };
    const latestSession = await getLatestChatSession(this.env, input.identity.scope);
    const activeThreadId =
      target === "current_thread"
        ? (input.threadId?.trim() ??
          this.snapshot?.activeThread?.threadId ??
          latestSession?.active_thread_id ??
          "")
        : "";

    if (target === "new_thread") {
      await upsertActiveAgentPreference(this.env, {
        userId: input.identity.scope.userId,
        workspaceId: input.identity.scope.workspaceId,
        agentId: targetAgent.id,
        reason: "agent-selected-new-thread",
      });
      if (latestSession?.session_id) {
        await updateChatSessionAgent(this.env, input.identity, {
          sessionId: latestSession.session_id,
          agentId: targetAgent.id,
          activeThreadId: null,
        });
      }
      this.snapshot = await buildSnapshot(this.env, activeIdentity, {
        revision: this.nextRevision(),
        activeAgent: targetAgent,
      });
      this.broadcastEvent(
        this.createEvent(
          "session.agent.handoff",
          safeAgentSwitchData(this.snapshot, { startedAt }),
        ),
      );
      this.broadcastEvent(
        this.createEvent("admin.summary.invalidated", {
          reason: "agent-selected-new-thread",
          agentId: targetAgent.id,
        }),
      );
      return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
        partial: true,
        threadsRefreshRecommended: true,
        transition: agentHandoffTransition(startedAt),
        agentHandoff: null,
      });
    }

    if (!activeThreadId) return { ok: false, error: "No active thread to continue", status: 400 };
    const thread = await getOwnedChatThread(this.env, input.identity.scope, activeThreadId);
    if (!thread || thread.status !== "active") {
      return { ok: false, error: "Thread not found", status: 404 };
    }
    if (thread.agent_id === targetAgent.id) {
      this.snapshot = await buildSnapshot(this.env, activeIdentity, {
        revision: this.nextRevision(),
        activeThread: thread,
        activeAgent: targetAgent,
      });
      return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
        partial: true,
      });
    }
    const runningRun = await getLatestRunningChatRun(
      this.env,
      input.identity.scope,
      thread.thread_id,
    );
    if (runningRun) {
      return { ok: false, error: "Thread has a running chat response", status: 409 };
    }
    await upsertActiveAgentPreference(this.env, {
      userId: input.identity.scope.userId,
      workspaceId: input.identity.scope.workspaceId,
      agentId: targetAgent.id,
      reason: "agent-handoff",
    });

    const fromAgent = await selectAgent(
      this.env,
      thread.agent_id,
      input.identity.scope.workspaceId,
    );
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
        agent: toAgentRuntimeMetadata(this.env, targetAgent, targetAgent.id),
      },
      handoff,
    );
    const timestamp = new Date().toISOString();
    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE chat_threads
         SET agent_id = ?,
             upstream_json = ?,
             updated_at = ?,
             last_seen_at = ?
         WHERE user_id = ? AND workspace_id = ? AND thread_id = ?`,
      ).bind(
        targetAgent.id,
        toJson(upstream),
        timestamp,
        timestamp,
        input.identity.scope.userId,
        input.identity.scope.workspaceId,
        thread.thread_id,
      ),
      this.env.DB.prepare(
        `UPDATE chat_sessions
         SET agent_id = ?,
             active_thread_id = ?,
             last_seen_at = ?,
             updated_at = ?
         WHERE user_id = ? AND workspace_id = ? AND session_id = ?`,
      ).bind(
        targetAgent.id,
        thread.thread_id,
        timestamp,
        timestamp,
        input.identity.scope.userId,
        input.identity.scope.workspaceId,
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
    this.snapshot = await buildSnapshot(this.env, activeIdentity, {
      revision: this.nextRevision(),
      activeThread: updatedThread,
      activeAgent: targetAgent,
    });
    this.snapshot.agentHandoff = handoff;

    await appendControlPlaneEvent(this.env, activeIdentity, {
      type: "session.agent.handoff",
      summary: `Switched agent from ${fromAgent?.name ?? "Unknown agent"} to ${targetAgent.name}.`,
      targetType: "chat_thread",
      targetId: thread.thread_id,
      data: { agentHandoff: handoff },
    });
    this.broadcastEvent(
      this.createEvent(
        "session.agent.handoff",
        safeAgentSwitchData(this.snapshot, { startedAt, agentHandoff: handoff }),
      ),
    );
    this.broadcastEvent(
      this.createEvent("admin.summary.invalidated", {
        reason: "agent-handoff",
        threadId: thread.thread_id,
        agentId: targetAgent.id,
      }),
    );
    return responseFromSnapshot(this.env, input.agentHost!, this.snapshot, {
      partial: true,
      threadsRefreshRecommended: true,
      transition: agentHandoffTransition(startedAt),
      agentHandoff: handoff,
    });
  }

  async stream(input: CoordinatorRequest) {
    const snapshot = await this.ensureSnapshot(input);
    return createSessionEventStream({
      snapshot,
      clients: this.clients,
      createEvent: (type, data, options) => this.createEvent(type, data, options),
      sendEvent: (controller, event) => this.sendEvent(controller, event),
      snapshotData: safeSnapshotData(snapshot),
    });
  }

  broadcast(input: CoordinatorRequest) {
    if (!input.event?.type) return { ok: false, error: "event.type is required", status: 400 };
    const event = this.createEvent(input.event.type, input.event.data ?? {}, {
      id: input.event.id,
      createdAt: input.event.createdAt,
      revision: input.event.revision,
    });
    this.broadcastEvent(event);
    return { ok: true, eventId: event.id };
  }

  async fetch(request: Request) {
    return handleSessionAgentRequest(this, request);
  }
}
