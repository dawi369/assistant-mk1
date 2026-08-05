import type {
  AgentSwitchTarget,
  ChatSessionResponse,
  ChatThreadsResponse,
  CloudflareActionsResponse,
  CloudflareAgentMutationResponse,
  CloudflareAgentsResponse,
  CloudflareArtifactHistoryResponse,
  CloudflareConnectionsResponse,
  ConnectionAuthorizationResponse,
  CloudflareExecutionHistoryResponse,
  CloudflareExecutionHistoryRunResponse,
  CloudflareManagedStateResponse,
  CloudflareToolApprovalActionResponse,
  CloudflareToolApprovalsResponse,
  CloudflareToolRunResponse,
  CloudflareWorkspaceMutationResponse,
  CloudflareWorkspacesResponse,
  ExecutionRunResponse,
  Id,
  WorkbenchAccountContextResponse,
} from "./contracts/index.js";
import {
  isJsonObject,
  parseWorkbenchResponse,
  WorkbenchResponseValidationError,
} from "./validation.js";

export type WorkbenchClientPlatform = "web" | "ios" | "android";

export type WorkbenchClientOptions = {
  baseUrl: string;
  getAccessToken?: (input?: { minValidityMs?: number }) => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  client: { platform: WorkbenchClientPlatform; version: string };
  timeoutMs?: number;
};

export class WorkbenchClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    requestId?: string;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "WorkbenchClientError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable ?? (input.status === 0 || input.status >= 500);
  }
}

export type WorkbenchRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: HeadersInit;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const normalizedBaseUrl = (value: string) => value.trim().replace(/\/$/, "");
const requestUrl = (baseUrl: string, path: string) =>
  baseUrl ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : path;

const errorFromBody = (body: unknown) => {
  if (!isJsonObject(body)) return {};
  return {
    code: typeof body.code === "string" ? body.code : undefined,
    message: typeof body.error === "string" ? body.error : undefined,
    retryable: typeof body.retryable === "boolean" ? body.retryable : undefined,
  };
};

const queryString = (input: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : "";
};

export const createWorkbenchClient = (options: WorkbenchClientOptions) => {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new TypeError("A fetch implementation is required");
  const baseUrl = normalizedBaseUrl(options.baseUrl);
  const defaultTimeoutMs = options.timeoutMs ?? 15_000;

  const request = async <T>(
    path: string,
    requestOptions: WorkbenchRequestOptions = {},
  ): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Workbench request timed out")),
      requestOptions.timeoutMs ?? defaultTimeoutMs,
    );
    const abortFromCaller = () => controller.abort(requestOptions.signal?.reason);
    requestOptions.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const token = await options.getAccessToken?.({ minValidityMs: 60_000 });
      const headers = new Headers(requestOptions.headers);
      headers.set("accept", "application/json");
      headers.set("x-workbench-client-platform", options.client.platform);
      headers.set("x-workbench-client-version", options.client.version);
      if (token) headers.set("authorization", `Bearer ${token}`);
      if (requestOptions.body !== undefined) headers.set("content-type", "application/json");
      if (requestOptions.idempotencyKey) {
        headers.set("idempotency-key", requestOptions.idempotencyKey);
      }

      const response = await fetcher(requestUrl(baseUrl, path), {
        method: requestOptions.method ?? "GET",
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        cache: "no-store",
        credentials: token ? "omit" : "include",
        signal: controller.signal,
      });
      const requestId = response.headers.get("x-request-id") ?? undefined;
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const parsed = errorFromBody(body);
        throw new WorkbenchClientError({
          status: response.status,
          requestId,
          code: parsed.code,
          retryable: parsed.retryable,
          message: parsed.message ?? `Workbench request failed (${response.status})`,
        });
      }
      return parseWorkbenchResponse<T>(body, path);
    } catch (error) {
      if (error instanceof WorkbenchClientError) throw error;
      if (error instanceof WorkbenchResponseValidationError) {
        throw new WorkbenchClientError({
          status: 0,
          code: "invalid_response",
          message: error.message,
          retryable: false,
        });
      }
      if (controller.signal.aborted) {
        throw new WorkbenchClientError({
          status: 0,
          code: requestOptions.signal?.aborted ? "request_cancelled" : "request_timeout",
          message: requestOptions.signal?.aborted
            ? "Workbench request was cancelled"
            : "Workbench request timed out",
          retryable: !requestOptions.signal?.aborted,
        });
      }
      throw new WorkbenchClientError({
        status: 0,
        code: "network_error",
        message: error instanceof Error ? error.message : "Workbench network request failed",
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      requestOptions.signal?.removeEventListener("abort", abortFromCaller);
    }
  };

  return {
    request,
    session: {
      get: (input: { refresh?: "threads"; source?: string; signal?: AbortSignal } = {}) =>
        request<ChatSessionResponse>(
          `/api/workbench/chat-session${queryString({ refresh: input.refresh, source: input.source })}`,
          { signal: input.signal },
        ),
      stageThread: (input: { source?: string } = {}) =>
        request<ChatSessionResponse>(
          `/api/workbench/chat-session/stage-thread${queryString({ source: input.source })}`,
          { method: "POST" },
        ),
      materializeTurn: (input: { text: string; clientTurnId: Id; clientWarmSession?: boolean }) =>
        request<ChatSessionResponse>("/api/workbench/chat-session/materialize-turn", {
          method: "POST",
          idempotencyKey: input.clientTurnId,
          body: {
            message: input.text,
            clientTurnId: input.clientTurnId,
            clientWarmSession: input.clientWarmSession,
          },
        }),
      switchAgent: (input: { agentId: Id; target: AgentSwitchTarget; threadId?: Id }) =>
        request<ChatSessionResponse>("/api/workbench/chat-session/agent-switch", {
          method: "POST",
          body: input,
        }),
    },
    threads: {
      list: (status: "active" | "archived" = "active") =>
        request<ChatThreadsResponse>(
          `/api/workbench/chat-session/threads${queryString({ status })}`,
        ),
      create: (title?: string) =>
        request<ChatSessionResponse>("/api/workbench/chat-session/threads", {
          method: "POST",
          body: title ? { title } : {},
        }),
      activate: (threadId: Id) =>
        request<ChatSessionResponse>(
          `/api/workbench/chat-session/threads/${encodeURIComponent(threadId)}/activate`,
          { method: "POST" },
        ),
      update: (
        threadId: Id,
        input: {
          title?: string;
          status?: "active" | "archived" | "deleted";
          fallbackTitle?: string;
        },
      ) =>
        request<ChatSessionResponse>(
          `/api/workbench/chat-session/threads/${encodeURIComponent(threadId)}`,
          { method: "PATCH", body: input },
        ),
    },
    workspaces: {
      listAccounts: () => request<WorkbenchAccountContextResponse>("/api/workbench/accounts"),
      list: () => request<CloudflareWorkspacesResponse>("/api/workbench/workspaces"),
      activate: (workspaceId: Id) =>
        request<CloudflareWorkspaceMutationResponse>(
          `/api/workbench/workspaces/${encodeURIComponent(workspaceId)}/activate`,
          { method: "POST" },
        ),
    },
    agents: {
      list: () => request<CloudflareAgentsResponse>("/api/workbench/agents"),
      activate: (agentId: Id) =>
        request<CloudflareAgentMutationResponse>(
          `/api/workbench/agents/${encodeURIComponent(agentId)}/activate`,
          { method: "POST" },
        ),
      instantiatePack: (packId: Id) =>
        request<CloudflareAgentMutationResponse>(
          `/api/workbench/agent-packs/${encodeURIComponent(packId)}/instantiate`,
          { method: "POST" },
        ),
    },
    workflows: {
      run: (
        workflowType: string,
        input: { input?: Record<string, unknown>; executionMode?: "dry_run" } = {},
      ) =>
        request<CloudflareToolRunResponse>(
          `/api/workbench/workflows/${encodeURIComponent(workflowType)}`,
          { method: "POST", body: input },
        ),
    },
    history: {
      listRuns: (input: { limit?: number } = {}) =>
        request<CloudflareExecutionHistoryResponse>(
          `/api/workbench/history/runs${queryString({ limit: input.limit })}`,
        ),
      getRun: (runId: Id) =>
        request<CloudflareExecutionHistoryRunResponse>(
          `/api/workbench/history/runs/${encodeURIComponent(runId)}`,
        ),
      listArtifacts: (input: { limit?: number } = {}) =>
        request<CloudflareArtifactHistoryResponse>(
          `/api/workbench/history/artifacts${queryString({ limit: input.limit })}`,
        ),
      cancel: (runId: Id) =>
        request<ExecutionRunResponse>(
          `/api/workbench/history/runs/${encodeURIComponent(runId)}/cancel`,
          { method: "POST" },
        ),
      retry: (runId: Id) =>
        request<ExecutionRunResponse>(
          `/api/workbench/history/runs/${encodeURIComponent(runId)}/retry`,
          { method: "POST" },
        ),
    },
    approvals: {
      list: () => request<CloudflareToolApprovalsResponse>("/api/workbench/tools/approvals"),
      approve: (approvalRequestId: Id) =>
        request<CloudflareToolApprovalActionResponse>(
          `/api/workbench/tools/approvals/${encodeURIComponent(approvalRequestId)}/approve`,
          { method: "POST" },
        ),
      deny: (approvalRequestId: Id, reason = "Denied by user") =>
        request<CloudflareToolApprovalActionResponse>(
          `/api/workbench/tools/approvals/${encodeURIComponent(approvalRequestId)}/deny`,
          { method: "POST", body: { reason } },
        ),
    },
    connections: {
      list: () => request<CloudflareConnectionsResponse>("/api/workbench/connections"),
      authorize: (connectionId: Id) =>
        request<ConnectionAuthorizationResponse>(
          `/api/workbench/connections/${encodeURIComponent(connectionId)}/authorize`,
          { method: "POST" },
        ),
      submitCredential: (connectionId: Id, secret: string) =>
        request<CloudflareConnectionsResponse>(
          `/api/workbench/connections/${encodeURIComponent(connectionId)}/credentials`,
          { method: "POST", body: { secret } },
        ),
      refresh: (connectionId: Id) =>
        request<CloudflareConnectionsResponse>(
          `/api/workbench/connections/${encodeURIComponent(connectionId)}/refresh`,
          { method: "POST" },
        ),
      health: (connectionId: Id) =>
        request<CloudflareConnectionsResponse>(
          `/api/workbench/connections/${encodeURIComponent(connectionId)}/health`,
          { method: "POST" },
        ),
      revoke: (connectionId: Id) =>
        request<CloudflareConnectionsResponse>(
          `/api/workbench/connections/${encodeURIComponent(connectionId)}`,
          { method: "DELETE" },
        ),
    },
    actions: {
      list: (input: { limit?: number } = {}) =>
        request<CloudflareActionsResponse>(
          `/api/workbench/actions${queryString({ limit: input.limit })}`,
        ),
      execute: (proposalId: Id) =>
        request<CloudflareActionsResponse>(
          `/api/workbench/actions/${encodeURIComponent(proposalId)}/execute`,
          { method: "POST" },
        ),
      reconcile: (proposalId: Id) =>
        request<CloudflareActionsResponse>(
          `/api/workbench/actions/${encodeURIComponent(proposalId)}/reconcile`,
          { method: "POST" },
        ),
    },
    managedState: {
      list: (input: { namespace?: string; type?: string; limit?: number } = {}) =>
        request<CloudflareManagedStateResponse>(
          `/api/workbench/managed-state${queryString(input)}`,
        ),
    },
  };
};

export type WorkbenchClient = ReturnType<typeof createWorkbenchClient>;
