import {
  createChatIntent,
  createChatPolicyDecision,
  createChatRun,
  createChatSession,
  getLatestChatSession,
  getLatestRunningChatRun,
  storeChatThread,
  touchChatSession,
  updateChatRun,
  updateChatThreadUpstream,
} from "./chat-boundary-store";
import {
  resolveAgentBehaviorConfig,
  resolveAgentBehaviorInstruction,
  resolveAgentRuntimeConfig,
  toAgentRuntimeMetadata,
  type AgentBehaviorConfig,
  type AgentRuntimeConfig,
} from "./agent-records";
import { selectAgent } from "./authz-store";
import { deriveChatExecutionMode, evaluateChatRunPolicy } from "./chat-policy";
import { appendControlPlaneEvent } from "./control-plane-events";
import { isRecord, json, parseDataJson, parseJson } from "./http";
import { createId, type AgentIdentity, type ChatThreadRow, type Env } from "./types";

type StoredMessage = {
  id: string;
  type: "system" | "human" | "ai";
  content: string;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
};

type ChatRuntimeErrorCode =
  | "unsupported_assistant"
  | "missing_model_secret"
  | "upstream_failed"
  | "runtime_failed";

class ChatRuntimeError extends Error {
  constructor(
    message: string,
    readonly errorCode: ChatRuntimeErrorCode,
    readonly retryable: boolean,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ChatRuntimeError";
  }
}

const modelProvider = "openrouter";

const sseHeaders = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

const textEncoder = new TextEncoder();

const sse = (event: string, data: unknown) =>
  textEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const truncate = (value: string, max = 1200) =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const asTextContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
};

const toStoredMessage = (value: unknown): StoredMessage | null => {
  if (!isRecord(value)) return null;
  const rawType = typeof value.type === "string" ? value.type : value.role;
  const type =
    rawType === "human" || rawType === "user"
      ? "human"
      : rawType === "ai" || rawType === "assistant"
        ? "ai"
        : rawType === "system"
          ? "system"
          : null;
  const content = asTextContent(value.content);
  if (!type || !content) return null;
  const id = typeof value.id === "string" ? value.id : createId(`cf-msg-${type}`);
  return { id, type, content };
};

const dedupeMessages = (messages: StoredMessage[]) => {
  const seen = new Set<string>();
  const result: StoredMessage[] = [];
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }
  return result;
};

const messagesFromThread = (thread: ChatThreadRow) => {
  const upstream = parseDataJson(thread.upstream_json);
  const rawMessages = Array.isArray(upstream.messages) ? upstream.messages : [];
  return rawMessages.map(toStoredMessage).filter((message) => message !== null);
};

const conversationMessages = (messages: StoredMessage[]) =>
  messages.filter((message) => message.type !== "system");

const threadUpstream = (input: {
  source: string;
  runtime: string;
  messages: StoredMessage[];
  model?: string;
  runtimeConfig?: AgentRuntimeConfig;
  behaviorConfig?: AgentBehaviorConfig;
  updatedAt?: string;
}) => ({
  source: input.source,
  runtime: input.runtime,
  modelProvider,
  model: input.model,
  runtimeConfig: input.runtimeConfig,
  behaviorConfig: input.behaviorConfig,
  messages: input.messages,
  updatedAt: input.updatedAt ?? new Date().toISOString(),
});

const messagesWithBehavior = (
  behaviorConfig: AgentBehaviorConfig,
  behaviorInstruction: string,
  messages: StoredMessage[],
) => [
  {
    id: `cf-system-${behaviorConfig.instructionId}`,
    type: "system" as const,
    content: behaviorInstruction,
  },
  ...conversationMessages(messages),
];

const openRouterMessages = (messages: StoredMessage[]) =>
  messages.map((message) => ({
    role: message.type === "human" ? "user" : message.type === "ai" ? "assistant" : message.type,
    content: message.content,
  }));

const extractInputMessages = (body: unknown) => {
  if (!isRecord(body) || !isRecord(body.input) || !Array.isArray(body.input.messages)) return [];
  return body.input.messages.map(toStoredMessage).filter((message) => message !== null);
};

const openRouterHeaders = (env: Env) => ({
  authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ""}`,
  "content-type": "application/json",
  "http-referer": env.OPENROUTER_SITE_URL ?? "https://assistant-mk1.vercel.app",
  "x-title": env.OPENROUTER_APP_NAME ?? "assistant-mk1-cloudflare-chat",
});

const readOpenRouterError = async (response: Response) => {
  const text = await response.text().catch(() => "");
  const parsed = parseJson(text);
  const message =
    isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string"
      ? parsed.error.message
      : text || `${response.status} ${response.statusText}`;
  return `${response.status} ${response.statusText}: ${truncate(message)}`;
};

const parseOpenRouterChunk = (block: string) => {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
  if (!data || data === "[DONE]") return { done: data === "[DONE]", content: "" };

  const parsed = parseJson(data);
  const choice =
    isRecord(parsed) && Array.isArray(parsed.choices) && isRecord(parsed.choices[0])
      ? parsed.choices[0]
      : null;
  const delta = isRecord(choice?.delta) ? choice.delta : null;
  return {
    done: false,
    content: typeof delta?.content === "string" ? delta.content : "",
  };
};

export const handleCloudflareCreateThread = async (env: Env, identity: AgentIdentity) => {
  const activeAgent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const runtimeConfig = resolveAgentRuntimeConfig(env, activeAgent);
  const behaviorConfig = resolveAgentBehaviorConfig(activeAgent);
  const agentMetadata = toAgentRuntimeMetadata(env, activeAgent, identity.agentId);
  const existingSession = await getLatestChatSession(env, identity.scope);
  const createdSession = !existingSession || existingSession.agent_id !== identity.agentId;
  const sessionId =
    !createdSession && existingSession
      ? existingSession.session_id
      : await createChatSession(env, identity, {
          source: "cloudflare-chat-runtime",
          agent: agentMetadata,
        });

  if (createdSession) {
    await appendControlPlaneEvent(env, identity, {
      type: "chat.session.created",
      summary: "Created Cloudflare-owned chat session.",
      targetType: "chat_session",
      targetId: sessionId,
      data: { source: "cloudflare-chat-runtime", agent: agentMetadata },
    });
  }

  const threadId = createId("cf-thread");
  await storeChatThread(
    env,
    identity,
    sessionId,
    threadId,
    threadUpstream({
      source: "cloudflare-chat-runtime",
      runtime: "cloudflare-simple-chat",
      messages: [],
      model: runtimeConfig.model,
      runtimeConfig,
      behaviorConfig,
    }),
  );
  await touchChatSession(env, identity.scope, sessionId, threadId);
  await appendControlPlaneEvent(env, identity, {
    type: "chat.thread.created",
    summary: "Created Cloudflare-owned chat thread.",
    targetType: "chat_thread",
    targetId: threadId,
    data: { sessionId, source: "cloudflare-chat-runtime", agent: agentMetadata },
  });

  return json(
    {
      thread_id: threadId,
      created_at: new Date().toISOString(),
      metadata: { source: "cloudflare-chat-runtime" },
      status: "idle",
    },
    { status: 201 },
  );
};

export const handleCloudflareThreadState = async (thread: ChatThreadRow) =>
  json({
    values: {
      messages: messagesFromThread(thread),
    },
    tasks: [],
    metadata: {
      thread_id: thread.thread_id,
      source: "cloudflare-chat-runtime",
    },
  });

export const handleCloudflareRunStream = async (
  env: Env,
  identity: AgentIdentity,
  thread: ChatThreadRow,
  bodyText: string,
) => {
  const parsedBody = parseJson(bodyText);
  const { executionMode, invalidExecutionMode, requestedExecutionMode } =
    deriveChatExecutionMode(parsedBody);
  const runningRun = await getLatestRunningChatRun(env, identity.scope, thread.thread_id);
  const policy = evaluateChatRunPolicy({
    executionMode,
    invalidExecutionMode,
    runningRun,
  });
  const requestedAssistantId = isRecord(parsedBody) ? parsedBody.assistant_id : undefined;
  const activeAgent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  const runtimeConfig = resolveAgentRuntimeConfig(env, activeAgent);
  const behaviorConfig = resolveAgentBehaviorConfig(activeAgent);
  const behaviorInstruction = resolveAgentBehaviorInstruction(activeAgent);
  const agentMetadata = toAgentRuntimeMetadata(env, activeAgent, identity.agentId);
  const inputMessages = extractInputMessages(parsedBody);
  const existingMessages = messagesFromThread(thread);
  const nextMessages = dedupeMessages(
    conversationMessages([...existingMessages, ...inputMessages]),
  );
  const intentId = await createChatIntent(env, identity, {
    sessionId: thread.session_id,
    threadId: thread.thread_id,
    executionMode,
    status: policy.decision === "allow" ? "allowed" : "blocked",
    payload: {
      assistantId: requestedAssistantId,
      bodyBytes: bodyText.length,
      messageCount: inputMessages.length,
      requestedExecutionMode,
      runtime: "cloudflare-simple-chat",
      agent: agentMetadata,
      runtimeConfig,
      behaviorConfig,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: "chat.intent.created",
    summary: "Created Cloudflare-owned chat response intent.",
    targetType: "chat_intent",
    targetId: intentId,
    data: {
      threadId: thread.thread_id,
      sessionId: thread.session_id,
      executionMode,
      status: policy.decision,
      runtime: "cloudflare-simple-chat",
      agent: agentMetadata,
      runtimeConfig,
      behaviorConfig,
    },
  });
  const policyDecisionId = await createChatPolicyDecision(env, identity, {
    intentId,
    threadId: thread.thread_id,
    decision: policy.decision,
    reason: policy.reason,
    executionMode,
    limits: {
      sameThreadConcurrency: 1,
      errorCode: policy.errorCode,
      retryable: policy.retryable,
    },
  });
  await appendControlPlaneEvent(env, identity, {
    type: policy.decision === "allow" ? "chat.policy.allowed" : "chat.policy.blocked",
    summary: policy.reason,
    targetType: "chat_policy_decision",
    targetId: policyDecisionId,
    data: {
      threadId: thread.thread_id,
      intentId,
      executionMode,
      agent: agentMetadata,
      runtimeConfig,
      behaviorConfig,
    },
  });

  if (policy.decision === "block") {
    return json(
      {
        ok: false,
        error: policy.reason,
        errorCode: policy.errorCode ?? "policy_blocked",
        retryable: policy.retryable ?? false,
        intentId,
        policyDecisionId,
        decision: policy.decision,
      },
      { status: policy.status },
    );
  }

  const runId = await createChatRun(env, identity, {
    threadId: thread.thread_id,
    intentId,
    policyDecisionId,
    metadata: {
      executionMode,
      runtime: "cloudflare-simple-chat",
      modelProvider: runtimeConfig.provider,
      model: runtimeConfig.model,
      runtimeConfig,
      behaviorConfig,
      agent: agentMetadata,
    },
  });
  await updateChatThreadUpstream(
    env,
    identity.scope,
    thread.thread_id,
    threadUpstream({
      source: "cloudflare-chat-runtime",
      runtime: "cloudflare-simple-chat",
      messages: nextMessages,
      model: runtimeConfig.model,
      runtimeConfig,
      behaviorConfig,
    }),
  );
  await appendControlPlaneEvent(env, identity, {
    type: "chat.run.started",
    summary: "Started Cloudflare-owned simple chat run.",
    targetType: "chat_run",
    targetId: runId,
    data: {
      threadId: thread.thread_id,
      intentId,
      policyDecisionId,
      executionMode,
      runtime: "cloudflare-simple-chat",
      agent: agentMetadata,
      runtimeConfig,
      behaviorConfig,
    },
  });

  if (requestedAssistantId !== "agent") {
    const error = "This assistant runtime is not available for Cloudflare simple chat.";
    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "failed",
      metadata: {
        runtime: "cloudflare-simple-chat",
        errorCode: "unsupported_assistant",
        retryable: false,
        requestedAssistantId,
      },
      error,
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.run.failed",
      summary: "Cloudflare simple chat rejected an unsupported assistant id.",
      targetType: "chat_run",
      targetId: runId,
      data: {
        threadId: thread.thread_id,
        error,
        errorCode: "unsupported_assistant",
        retryable: false,
        requestedAssistantId,
      },
    });
    return json(
      { ok: false, error, errorCode: "unsupported_assistant", retryable: false },
      { status: 422 },
    );
  }

  if (!env.OPENROUTER_API_KEY) {
    const error = "Chat model is not configured for Cloudflare simple chat.";
    await updateChatRun(env, {
      runId,
      scope: identity.scope,
      status: "failed",
      metadata: {
        runtime: "cloudflare-simple-chat",
        errorCode: "missing_model_secret",
        retryable: false,
      },
      error,
    });
    await appendControlPlaneEvent(env, identity, {
      type: "chat.run.failed",
      summary: "Cloudflare simple chat model secret is missing.",
      targetType: "chat_run",
      targetId: runId,
      data: {
        threadId: thread.thread_id,
        error,
        errorCode: "missing_model_secret",
        retryable: false,
      },
    });
    return json(
      { ok: false, error, errorCode: "missing_model_secret", retryable: false },
      { status: 500 },
    );
  }

  const model = runtimeConfig.model;
  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        let assistantText = "";
        const assistantMessageId = createId("cf-ai");
        const metadata = {
          thread_id: thread.thread_id,
          run_id: runId,
          runtime: "cloudflare-simple-chat",
          model_provider: runtimeConfig.provider,
          ls_model_name: model,
          runtime_config: runtimeConfig,
          behavior_config: behaviorConfig,
          langgraph_node: "cloudflare-simple-chat",
          agent: agentMetadata,
        };

        try {
          controller.enqueue(sse("metadata", metadata));
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: openRouterHeaders(env),
            body: JSON.stringify({
              model,
              temperature: runtimeConfig.temperature,
              max_tokens: runtimeConfig.maxTokens,
              stream: true,
              messages: openRouterMessages(
                messagesWithBehavior(behaviorConfig, behaviorInstruction, nextMessages),
              ),
            }),
          });

          if (!response.ok || !response.body) {
            const detail = await readOpenRouterError(response);
            throw new ChatRuntimeError(
              "The response failed. Try again or start a new chat.",
              "upstream_failed",
              true,
              detail,
            );
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() ?? "";

            for (const block of blocks) {
              const parsed = parseOpenRouterChunk(block);
              if (parsed.done) break;
              if (!parsed.content) continue;
              assistantText += parsed.content;
              controller.enqueue(
                sse("messages", [
                  {
                    id: assistantMessageId,
                    content: parsed.content,
                    additional_kwargs: {},
                    response_metadata: { model_name: model },
                    type: "AIMessageChunk",
                    name: null,
                    tool_calls: [],
                    invalid_tool_calls: [],
                    tool_call_chunks: [],
                  },
                  metadata,
                ]),
              );
            }
          }

          const finalMessages = dedupeMessages([
            ...nextMessages,
            {
              id: assistantMessageId,
              type: "ai",
              content: assistantText,
              response_metadata: { model_name: model },
            },
          ]);
          await updateChatThreadUpstream(
            env,
            identity.scope,
            thread.thread_id,
            threadUpstream({
              source: "cloudflare-chat-runtime",
              runtime: "cloudflare-simple-chat",
              messages: finalMessages,
              model,
              runtimeConfig,
              behaviorConfig,
            }),
          );
          await updateChatRun(env, {
            runId,
            scope: identity.scope,
            status: "completed",
            metadata: { ...metadata, outputChars: assistantText.length },
          });
          await appendControlPlaneEvent(env, identity, {
            type: "chat.run.completed",
            summary: "Cloudflare-owned simple chat run completed.",
            targetType: "chat_run",
            targetId: runId,
            data: { threadId: thread.thread_id, runId, runtime: "cloudflare-simple-chat" },
          });
          controller.close();
        } catch (error) {
          const runtimeError =
            error instanceof ChatRuntimeError
              ? error
              : new ChatRuntimeError(
                  "The response failed. Try again or start a new chat.",
                  "runtime_failed",
                  true,
                  error instanceof Error ? error.message : undefined,
                );
          const message = runtimeError.message;
          await updateChatRun(env, {
            runId,
            scope: identity.scope,
            status: "failed",
            metadata: {
              ...metadata,
              outputChars: assistantText.length,
              errorCode: runtimeError.errorCode,
              retryable: runtimeError.retryable,
              errorDetail: runtimeError.detail,
            },
            error: truncate(message),
          });
          await appendControlPlaneEvent(env, identity, {
            type: "chat.run.failed",
            summary: "Cloudflare-owned simple chat run failed.",
            targetType: "chat_run",
            targetId: runId,
            data: {
              threadId: thread.thread_id,
              error: truncate(message),
              errorCode: runtimeError.errorCode,
              retryable: runtimeError.retryable,
              errorDetail: runtimeError.detail,
            },
          });
          controller.enqueue(
            sse("error", {
              message: truncate(message),
              errorCode: runtimeError.errorCode,
              retryable: runtimeError.retryable,
            }),
          );
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...sseHeaders,
      "content-location": `/threads/${thread.thread_id}/runs/${runId}`,
    },
  });
};
