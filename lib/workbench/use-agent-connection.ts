"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  workbenchAgentNewChatEvent,
  workbenchAgentSelectThreadEvent,
  type WorkbenchAgentConnection,
} from "@/lib/workbench/agent-chat-events";
import { requestWorkbenchSummaryRefresh } from "@/lib/workbench/admin-summary-events";
import type { ChatSessionResponse } from "@/lib/workbench/workbench-types";

const sessionPath = "/api/workbench/chat-session";
const tokenRefreshSkewMs = 60_000;
const minimumRefreshDelayMs = 5_000;

const readSession = async (
  input: {
    action?: "read" | "create" | "activate";
    threadId?: string;
  } = {},
): Promise<ChatSessionResponse> => {
  const path =
    input.action === "create"
      ? `${sessionPath}/threads`
      : input.action === "activate" && input.threadId
        ? `${sessionPath}/threads/${encodeURIComponent(input.threadId)}/activate`
        : sessionPath;
  const response = await fetch(path, {
    method: input.action === "create" || input.action === "activate" ? "POST" : "GET",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as ChatSessionResponse & {
    error?: string;
  };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? "Failed to load Cloudflare chat session");
  }
  if (
    !body.connection?.agentHost ||
    !body.connection.agentName ||
    !body.connection.instanceName ||
    !body.connection.token
  ) {
    throw new Error("Cloudflare Agent connection response was incomplete");
  }
  return body;
};

export function useWorkbenchAgentConnection() {
  const [session, setSession] = useState<ChatSessionResponse | null>(null);
  const [connection, setConnection] = useState<WorkbenchAgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const connectionRef = useRef<WorkbenchAgentConnection | null>(null);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const loadConnection = useCallback(
    async (input: { action?: "read" | "create" | "activate"; threadId?: string } = {}) => {
      const hasConnection = Boolean(connectionRef.current);
      setIsConnecting(
        Boolean(input.action === "create" || input.action === "activate" || !hasConnection),
      );
      try {
        setError(null);
        const nextSession = await readSession(input);
        const nextConnection = nextSession.connection
          ? { ...nextSession.connection, expiresAt: nextSession.expiresAt }
          : null;
        if (!nextConnection) {
          throw new Error("Cloudflare Agent connection response was incomplete");
        }
        setSession(nextSession);
        setConnection(nextConnection);
        requestWorkbenchSummaryRefresh();
        window.setTimeout(requestWorkbenchSummaryRefresh, 500);
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Agent connection failed";
        if (!connectionRef.current || input.action === "create" || input.action === "activate") {
          setError(message);
        } else {
          console.warn("Cloudflare Agent token refresh failed", nextError);
        }
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  useEffect(() => {
    const newChatListener = () => void loadConnection({ action: "create" });
    const selectThreadListener = (event: Event) => {
      const threadId =
        event instanceof CustomEvent && typeof event.detail?.threadId === "string"
          ? event.detail.threadId
          : null;
      if (!threadId) return;
      void loadConnection({ action: "activate", threadId });
    };
    window.addEventListener(workbenchAgentNewChatEvent, newChatListener);
    window.addEventListener(workbenchAgentSelectThreadEvent, selectThreadListener);
    return () => {
      window.removeEventListener(workbenchAgentNewChatEvent, newChatListener);
      window.removeEventListener(workbenchAgentSelectThreadEvent, selectThreadListener);
    };
  }, [loadConnection]);

  useEffect(() => {
    if (!connection?.expiresAt) return;

    const expiresAtMs = Date.parse(connection.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return;

    const refreshDelayMs = Math.max(
      minimumRefreshDelayMs,
      expiresAtMs - Date.now() - tokenRefreshSkewMs,
    );
    const timeout = window.setTimeout(() => void loadConnection(), refreshDelayMs);
    return () => window.clearTimeout(timeout);
  }, [connection?.expiresAt, loadConnection]);

  return {
    connection,
    session,
    error,
    isConnecting,
    retry: () => void loadConnection(),
  };
}
