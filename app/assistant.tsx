"use client";

/**
 * Client runtime bridge between assistant-ui and Cloudflare Agents.
 *
 * Vercel forwards the WorkOS/local session to Cloudflare. Cloudflare owns the
 * active workspace/thread/agent session, mints the short-lived Agent token, and
 * the browser talks to the per-thread Durable Object through the Agents SDK.
 */
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";

import { Thread } from "@/components/assistant-ui/thread";
import {
  type WorkbenchAgentConnection,
  useWorkbenchAgentConnection,
} from "@/lib/workbench/use-agent-connection";

const toAgentHostOptions = (agentHost: string) => {
  const parsed = new URL(agentHost);
  return {
    host: parsed.host,
    protocol: parsed.protocol === "http:" ? ("ws" as const) : ("wss" as const),
  };
};

export function Assistant({ children }: { children?: ReactNode }) {
  const { connection, error, retry, session } = useWorkbenchAgentConnection();

  if (error && !connection) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="border-border bg-background max-w-md rounded-md border p-4 text-sm shadow-xs">
          <div className="font-medium">Cloudflare Agent connection failed</div>
          <p className="text-muted-foreground mt-1">{error}</p>
          <button
            type="button"
            className="border-border hover:bg-muted mt-3 rounded-md border px-3 py-1.5 text-sm"
            onClick={retry}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {session?.isStale
          ? "Refreshing Cloudflare chat session..."
          : "Connecting to Cloudflare Agent..."}
      </div>
    );
  }

  return (
    <AgentRuntime key={connection.threadId ?? connection.instanceName} connection={connection}>
      {children}
      <Thread />
    </AgentRuntime>
  );
}

function AgentRuntime({
  connection,
  children,
}: {
  connection: WorkbenchAgentConnection;
  children?: ReactNode;
}) {
  const [isOpeningThread, setIsOpeningThread] = useState(false);
  const hostOptions = useMemo(
    () => toAgentHostOptions(connection.agentHost!),
    [connection.agentHost],
  );

  useEffect(() => {
    setIsOpeningThread(true);
    const timeout = window.setTimeout(() => setIsOpeningThread(false), 900);
    return () => window.clearTimeout(timeout);
  }, [connection.threadId, connection.instanceName]);

  const agent = useAgent({
    agent: "WorkbenchThreadChatAgent",
    name: connection.instanceName!,
    host: hostOptions.host,
    protocol: hostOptions.protocol,
    query: { token: connection.token! },
    enabled: Boolean(connection.token),
  });
  const chat = useAgentChat({
    agent,
    body: () => ({
      token: connection.token!,
      threadId: connection.threadId,
      traceId: `trace-${crypto.randomUUID()}`,
    }),
  });
  const runtime = useAISDKRuntime(chat);
  const providerRuntime = runtime as unknown as ComponentProps<
    typeof AssistantRuntimeProvider
  >["runtime"];

  return (
    <AssistantRuntimeProvider runtime={providerRuntime}>
      <div className="relative h-full">
        {children}
        {isOpeningThread ? (
          <div className="pointer-events-none absolute top-20 left-1/2 z-20 -translate-x-1/2 rounded-md border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-xs backdrop-blur">
            Opening chat...
          </div>
        ) : null}
      </div>
    </AssistantRuntimeProvider>
  );
}
