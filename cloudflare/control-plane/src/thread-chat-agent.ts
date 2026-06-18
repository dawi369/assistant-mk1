import { AIChatAgent } from "@cloudflare/ai-chat";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import type { Connection, ConnectionContext } from "agents";

import {
  resolveAgentBehaviorConfig,
  resolveAgentBehaviorInstruction,
  resolveAgentRuntimeConfig,
  toAgentBehaviorMetadata,
  toAgentRuntimeMetadata,
} from "./agent-records";
import { claimsToIdentity, verifyAgentConnectionToken } from "./agent-connection-token";
import type { AgentConnectionClaims } from "./agent-connection-token";
import { selectAgent } from "./authz-store";
import { deriveThreadAgentInstanceName } from "./chat-agent-connection-context";
import {
  createAgentChatRunStartMirror,
  touchChatThread,
  updateChatRun,
  updateChatThreadUpstream,
} from "./chat-boundary-store";
import { finishTrace, recordSpan, type RuntimeTraceContext } from "./runtime-traces";
import { dispatchWorkbenchSessionEvent } from "./session-coordinator";
import { resolveModelVisibleTools } from "./model-tools";
import type { AgentRow, Env, WorkerExecutionContext } from "./types";

const getRequiredSecret = (env: Env) => {
  const secret = env.WORKBENCH_AGENT_CONNECTION_SECRET?.trim();
  if (!secret) throw new Error("WORKBENCH_AGENT_CONNECTION_SECRET is not configured");
  return secret;
};

const getTokenFromRequest = (request: Request) =>
  new URL(request.url).searchParams.get("token")?.trim() ?? "";

const getTokenFromBody = (body?: Record<string, unknown>) =>
  typeof body?.token === "string" ? body.token.trim() : "";

const getTraceIdFromBody = (body?: Record<string, unknown>) =>
  typeof body?.traceId === "string" && body.traceId.trim() ? body.traceId.trim() : undefined;

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ("text" in part && typeof part.text === "string") return part.text;
      if ("content" in part && typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join(" ");
};

const summarizeMessages = (messages: readonly unknown[]) => {
  const firstUser = messages.find((message) => {
    if (!message || typeof message !== "object") return false;
    const role = "role" in message ? message.role : "type" in message ? message.type : undefined;
    return role === "user" || role === "human";
  });
  const content =
    firstUser && typeof firstUser === "object" && "content" in firstUser ? firstUser.content : "";
  const title = textFromContent(content).replace(/\s+/g, " ").trim();
  return {
    messageCount: messages.length,
    title: title ? (title.length > 56 ? `${title.slice(0, 53)}...` : title) : "New chat",
  };
};

type ResolvedAgentChatConfig = {
  cacheKey: string;
  agentRow: AgentRow | null;
  runtimeConfig: ReturnType<typeof resolveAgentRuntimeConfig>;
  behaviorConfig: ReturnType<typeof resolveAgentBehaviorConfig>;
  behaviorInstruction: string;
  agentMetadata: ReturnType<typeof toAgentRuntimeMetadata>;
};

type ConfigResolveResult = ResolvedAgentChatConfig & {
  cacheStatus: "hit" | "miss";
};

export class WorkbenchThreadChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  private agentConfigCache: ResolvedAgentChatConfig | null = null;

  private getEnv() {
    return (this as unknown as { env: Env }).env;
  }
  private waitUntil(promise: Promise<unknown>) {
    (this as unknown as { ctx: WorkerExecutionContext }).ctx.waitUntil(promise);
  }
  messageConcurrency = "drop" as const;

  private cacheKey(claims: AgentConnectionClaims, row: AgentRow | null) {
    return `${claims.workspaceId}:${claims.agentId}:${claims.agentUpdatedAt ?? row?.updated_at ?? "unknown"}`;
  }

  private async verifyScopedClaims(token: string) {
    const claims = await verifyAgentConnectionToken(getRequiredSecret(this.getEnv()), token);
    const expectedInstanceName = await deriveThreadAgentInstanceName({
      userId: claims.userId,
      workspaceId: claims.workspaceId,
      agentId: claims.agentId,
      threadId: claims.threadId,
    });
    if (claims.instanceName !== expectedInstanceName || claims.instanceName !== this.name) {
      throw new Error("Agent token scope mismatch");
    }
    return claims;
  }

  private async resolveChatConfig(claims: AgentConnectionClaims): Promise<ConfigResolveResult> {
    const cached = this.agentConfigCache;
    if (cached) {
      const expectedCacheKey = this.cacheKey(claims, cached.agentRow);
      if (cached.cacheKey === expectedCacheKey) {
        return { ...cached, cacheStatus: "hit" };
      }
    }

    const activeAgent = await selectAgent(this.getEnv(), claims.agentId, claims.workspaceId);
    const runtimeConfig = resolveAgentRuntimeConfig(this.getEnv(), activeAgent);
    const behaviorConfig = resolveAgentBehaviorConfig(activeAgent);
    const resolved = {
      cacheKey: this.cacheKey(claims, activeAgent),
      agentRow: activeAgent,
      runtimeConfig,
      behaviorConfig,
      behaviorInstruction: resolveAgentBehaviorInstruction(activeAgent),
      agentMetadata: toAgentRuntimeMetadata(this.getEnv(), activeAgent, claims.agentId),
    };
    this.agentConfigCache = resolved;
    return { ...resolved, cacheStatus: "miss" };
  }

  async fetch(request: Request) {
    try {
      await this.verifyScopedClaims(getTokenFromRequest(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent authentication failed";
      return new Response(message, { status: message.includes("scope") ? 403 : 401 });
    }
    return super.fetch(request);
  }

  async onConnect(connection: Connection, context: ConnectionContext) {
    try {
      const claims = await this.verifyScopedClaims(getTokenFromRequest(context.request));
      await this.resolveChatConfig(claims);
      await super.onConnect(connection, context);
    } catch (error) {
      connection.close(
        1008,
        error instanceof Error ? error.message : "Agent authentication failed",
      );
    }
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: Parameters<AIChatAgent<Env>["onChatMessage"]>[1],
  ) {
    const tokenVerifyStartedAtMs = Date.now();
    const claims = await this.verifyScopedClaims(getTokenFromBody(options?.body));
    const tokenVerifyEndedAtMs = Date.now();
    if (!this.getEnv().OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured");

    const identity = claimsToIdentity(claims);
    const requestStartedAtMs = Date.now();
    const trace: RuntimeTraceContext = {
      traceId: getTraceIdFromBody(options?.body) ?? `trace-${crypto.randomUUID()}`,
      kind: "chat.agent.stream",
      rootName: "Cloudflare Agent chat response",
      startedAtMs: requestStartedAtMs,
    };

    let runId: string | null = null;
    let firstTokenAtMs: number | null = null;
    let providerStartedAtMs = 0;
    let terminalState: "open" | "completed" | "failed" = "open";
    const traceWritePromises: Promise<unknown>[] = [];
    const queueTraceWrite = (promise: Promise<unknown>) => {
      const guarded = promise.catch((error) => {
        console.error("Failed to record Agent runtime span", error);
      });
      traceWritePromises.push(guarded);
      this.waitUntil(guarded);
      return guarded;
    };
    const markTerminal = (state: "completed" | "failed") => {
      if (terminalState !== "open") return false;
      terminalState = state;
      return true;
    };

    try {
      const configStartedAtMs = Date.now();
      const { runtimeConfig, behaviorConfig, behaviorInstruction, agentMetadata, cacheStatus } =
        await this.resolveChatConfig(claims);
      const configEndedAtMs = Date.now();

      const runStart = await createAgentChatRunStartMirror(this.getEnv(), identity, {
        traceId: trace.traceId,
        traceStartedAtMs: trace.startedAtMs,
        tokenVerifyStartedAtMs,
        tokenVerifyEndedAtMs,
        configResolveStartedAtMs: configStartedAtMs,
        configResolveEndedAtMs: configEndedAtMs,
        configCacheStatus: cacheStatus,
        sessionId: claims.sessionId,
        threadId: claims.threadId,
        requestId: options?.requestId,
        agentMetadata,
        model: runtimeConfig.model,
        runtimeConfig,
        behavior: toAgentBehaviorMetadata(behaviorConfig),
      });
      runId = runStart.runId;
      this.waitUntil(
        dispatchWorkbenchSessionEvent(this.getEnv(), identity, {
          type: "chat.run.started",
          data: {
            runtime: "cloudflare-agent-chat",
            status: "running",
            threadId: claims.threadId,
            sessionId: claims.sessionId,
            runId,
            traceId: trace.traceId,
            model: runtimeConfig.model,
          },
        }),
      );
      queueTraceWrite(
        recordSpan(this.getEnv(), identity, {
          traceId: trace.traceId,
          name: "D1 run-start batch",
          layer: "d1",
          startedAtMs: runStart.batchStartedAtMs,
          endedAtMs: runStart.batchEndedAtMs,
          data: {
            intentId: runStart.intentId,
            policyDecisionId: runStart.policyDecisionId,
            runId,
            d1DurationMs: runStart.d1DurationMs,
            wallClockMs: runStart.batchEndedAtMs - runStart.batchStartedAtMs,
          },
        }),
      );

      const toolResolveStartedAtMs = Date.now();
      const modelTools = await resolveModelVisibleTools(this.getEnv(), identity, {
        chatRunId: runId,
        threadId: claims.threadId,
        traceId: trace.traceId,
      });
      queueTraceWrite(
        recordSpan(this.getEnv(), identity, {
          traceId: trace.traceId,
          name: "Model tool exposure resolver",
          layer: "cloudflare",
          startedAtMs: toolResolveStartedAtMs,
          endedAtMs: Date.now(),
          status:
            modelTools.exposure.decision === "allow" || modelTools.exposure.fastPath
              ? "completed"
              : "blocked",
          data: {
            code: modelTools.exposure.code,
            reason: modelTools.exposure.reason,
            fastPath: Boolean(modelTools.exposure.fastPath),
            visibleToolCount: Object.keys(modelTools.tools).length,
          },
        }),
      );

      providerStartedAtMs = Date.now();
      queueTraceWrite(
        recordSpan(this.getEnv(), identity, {
          traceId: trace.traceId,
          name: "OpenRouter request",
          layer: "provider",
          startedAtMs: providerStartedAtMs,
          endedAtMs: providerStartedAtMs,
          spanType: "event",
          isAggregate: false,
          bottleneckCandidate: false,
          data: { model: runtimeConfig.model },
        }),
      );
      const openrouter = createOpenRouter({
        apiKey: this.getEnv().OPENROUTER_API_KEY,
        headers: {
          ...(this.getEnv().OPENROUTER_SITE_URL
            ? { "HTTP-Referer": this.getEnv().OPENROUTER_SITE_URL }
            : {}),
          ...(this.getEnv().OPENROUTER_APP_NAME
            ? { "X-Title": this.getEnv().OPENROUTER_APP_NAME }
            : {}),
        },
      });
      const result = streamText({
        model: openrouter.chat(runtimeConfig.model),
        system: behaviorInstruction,
        messages: await convertToModelMessages(this.messages),
        tools: modelTools.tools,
        stopWhen: stepCountIs(3),
        temperature: runtimeConfig.temperature,
        maxOutputTokens: runtimeConfig.maxTokens,
        abortSignal: options?.abortSignal,
        onChunk: async () => {
          if (firstTokenAtMs !== null) return;
          firstTokenAtMs = Date.now();
          queueTraceWrite(
            recordSpan(this.getEnv(), identity, {
              traceId: trace.traceId,
              name: "OpenRouter first token",
              layer: "provider",
              startedAtMs: providerStartedAtMs,
              endedAtMs: firstTokenAtMs,
              data: { model: runtimeConfig.model },
            }),
          );
        },
        onFinish: async (event) => {
          const endedAtMs = Date.now();
          try {
            await onFinish(event);
          } catch (error) {
            if (markTerminal("failed")) {
              await failAgentRun(this.getEnv(), identity, trace, {
                runId,
                error,
                startedAtMs: requestStartedAtMs,
              });
            }
            throw error;
          }
          if (!markTerminal("completed")) return;
          this.waitUntil(
            (async () => {
              const completionMirrorStartedAtMs = Date.now();
              if (runId) {
                await updateChatRun(this.getEnv(), {
                  runId,
                  scope: identity.scope,
                  status: "completed",
                  metadata: {
                    runtime: "cloudflare-agent-chat",
                    model: runtimeConfig.model,
                    behavior: toAgentBehaviorMetadata(behaviorConfig),
                    timings: {
                      firstTokenMs: firstTokenAtMs
                        ? firstTokenAtMs - providerStartedAtMs
                        : undefined,
                      totalMs: endedAtMs - requestStartedAtMs,
                      providerMs: endedAtMs - providerStartedAtMs,
                    },
                  },
                });
              }
              await updateChatThreadUpstream(this.getEnv(), identity.scope, claims.threadId, {
                source: "cloudflare-agent-chat",
                runtime: "cloudflare-agent-chat",
                threadId: claims.threadId,
                instanceName: claims.instanceName,
                agent: agentMetadata,
                lastRunId: runId,
                ...summarizeMessages(this.messages),
              });
              await touchChatThread(this.getEnv(), identity.scope, claims.threadId);
              await recordSpan(this.getEnv(), identity, {
                traceId: trace.traceId,
                name: "Stream duration",
                layer: "provider",
                startedAtMs: firstTokenAtMs ?? providerStartedAtMs,
                endedAtMs,
                data: { model: runtimeConfig.model },
              });
              await recordSpan(this.getEnv(), identity, {
                traceId: trace.traceId,
                name: "D1 completion mirror",
                layer: "d1",
                startedAtMs: completionMirrorStartedAtMs,
                endedAtMs: Date.now(),
                data: { runId },
              });
              await recordSpan(this.getEnv(), identity, {
                traceId: trace.traceId,
                name: "Durable Object message persist",
                layer: "durable_object",
                startedAtMs: requestStartedAtMs,
                endedAtMs,
                spanType: "phase",
                isAggregate: true,
                bottleneckCandidate: false,
                data: { note: "AIChatAgent persisted hot thread messages in DO SQLite." },
              });
              await Promise.allSettled(traceWritePromises);
              await finishTrace(this.getEnv(), identity, trace, {
                status: "completed",
                summary: "Agent chat response completed.",
                data: {
                  runtime: "cloudflare-agent-chat",
                  threadId: claims.threadId,
                  sessionId: claims.sessionId,
                  runId,
                },
                endedAtMs,
              });
              await dispatchWorkbenchSessionEvent(this.getEnv(), identity, {
                type: "chat.run.completed",
                data: {
                  runtime: "cloudflare-agent-chat",
                  status: "completed",
                  threadId: claims.threadId,
                  sessionId: claims.sessionId,
                  runId,
                  traceId: trace.traceId,
                  timings: {
                    firstTokenMs: firstTokenAtMs ? firstTokenAtMs - providerStartedAtMs : undefined,
                    totalMs: endedAtMs - requestStartedAtMs,
                  },
                },
              });
              await dispatchWorkbenchSessionEvent(this.getEnv(), identity, {
                type: "trace.updated",
                data: {
                  traceId: trace.traceId,
                  kind: trace.kind,
                  status: "completed",
                  threadId: claims.threadId,
                  runId,
                },
              });
              await dispatchWorkbenchSessionEvent(this.getEnv(), identity, {
                type: "admin.summary.invalidated",
                data: {
                  reason: "chat-run-completed",
                  threadId: claims.threadId,
                  runId,
                  traceId: trace.traceId,
                },
              });
            })(),
          );
        },
        onError: async ({ error }) => {
          if (markTerminal("failed")) {
            await failAgentRun(this.getEnv(), identity, trace, {
              runId,
              error,
              startedAtMs: requestStartedAtMs,
            });
          }
        },
      });

      return result.toUIMessageStreamResponse();
    } catch (error) {
      if (markTerminal("failed")) {
        await failAgentRun(this.getEnv(), identity, trace, {
          runId,
          error,
          startedAtMs: requestStartedAtMs,
        });
      }
      throw error;
    }
  }
}

const failAgentRun = async (
  env: Env,
  identity: ReturnType<typeof claimsToIdentity>,
  trace: RuntimeTraceContext,
  input: { runId: string | null; error: unknown; startedAtMs: number },
) => {
  const message = input.error instanceof Error ? input.error.message : "Agent chat failed";
  if (input.runId) {
    await updateChatRun(env, {
      runId: input.runId,
      scope: identity.scope,
      status: "failed",
      error: message,
      metadata: {
        runtime: "cloudflare-agent-chat",
        errorCode: "runtime_failed",
        retryable: true,
      },
    });
  }
  await recordSpan(env, identity, {
    traceId: trace.traceId,
    name: "Agent chat failed",
    layer: "durable_object",
    status: "failed",
    startedAtMs: input.startedAtMs,
    endedAtMs: Date.now(),
    data: { errorCode: "runtime_failed" },
  });
  await finishTrace(env, identity, trace, {
    status: "failed",
    summary: message,
    data: { runtime: "cloudflare-agent-chat", errorCode: "runtime_failed", retryable: true },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "chat.run.failed",
    data: {
      runtime: "cloudflare-agent-chat",
      status: "failed",
      runId: input.runId,
      traceId: trace.traceId,
      errorCode: "runtime_failed",
      retryable: true,
      message,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "trace.updated",
    data: {
      traceId: trace.traceId,
      kind: trace.kind,
      status: "failed",
      runId: input.runId,
    },
  });
  await dispatchWorkbenchSessionEvent(env, identity, {
    type: "admin.summary.invalidated",
    data: {
      reason: "chat-run-failed",
      runId: input.runId,
      traceId: trace.traceId,
    },
  });
};
