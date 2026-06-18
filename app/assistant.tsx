"use client";

/**
 * Client runtime bridge between assistant-ui and Cloudflare Agents.
 *
 * Vercel forwards the WorkOS/local session to Cloudflare. Cloudflare owns the
 * active workspace/thread/agent session, mints the short-lived Agent token, and
 * the browser talks to the per-thread Durable Object through the Agents SDK.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { AssistantRuntimeProvider, useAui } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { ArrowUpIcon, Loader2Icon, PaperclipIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  const [preRuntimeDraft, setPreRuntimeDraft] = useState("");
  const clearPreRuntimeDraft = useCallback(() => setPreRuntimeDraft(""), []);

  if (!connection) {
    return (
      <PreRuntimeDraftSurface
        draft={preRuntimeDraft}
        error={error}
        onDraftChange={setPreRuntimeDraft}
        onRetry={retry}
        session={session}
      />
    );
  }

  return (
    <AgentRuntime
      key={connection.threadId ?? connection.instanceName}
      connection={connection}
      draft={preRuntimeDraft}
      onDraftHydrated={clearPreRuntimeDraft}
    >
      {children}
      <Thread />
    </AgentRuntime>
  );
}

function AgentRuntime({
  connection,
  draft,
  onDraftHydrated,
  children,
}: {
  connection: WorkbenchAgentConnection;
  draft: string;
  onDraftHydrated: () => void;
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
      <RuntimeDraftHandoff draft={draft} onHydrated={onDraftHydrated} />
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

function RuntimeDraftHandoff({ draft, onHydrated }: { draft: string; onHydrated: () => void }) {
  const aui = useAui();
  const attemptedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    if (!draft || attemptedDraftRef.current === draft) return;

    const composer = aui.composer();
    const currentText = composer.getState().text ?? "";
    attemptedDraftRef.current = draft;

    if (currentText === draft) {
      onHydrated();
      return;
    }
    if (currentText.length > 0) return;

    composer.setText(draft);
    onHydrated();
  }, [aui, draft, onHydrated]);

  return null;
}

function PreRuntimeDraftSurface({
  draft,
  error,
  onDraftChange,
  onRetry,
  session,
}: {
  draft: string;
  error: string | null;
  onDraftChange: (draft: string) => void;
  onRetry: () => Promise<void>;
  session: ReturnType<typeof useWorkbenchAgentConnection>["session"];
}) {
  const activeThreadLabel = session?.activeThread?.title || session?.activeThread?.threadId;
  const hasCachedShell = session?.isStale === true;
  const statusLabel = error ? "Connection failed" : "Connecting to Cloudflare Agent";
  const statusDescription = error
    ? error
    : hasCachedShell
      ? "Cached workspace is visible while the live Agent token refreshes."
      : "You can start drafting while the Agent connection opens.";

  return (
    <div
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      <div className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth">
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          <div className="my-auto flex grow flex-col">
            <div className="flex w-full grow flex-col items-center justify-center">
              <div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex size-full flex-col justify-center px-4 duration-200">
                <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                  {error ? (
                    <span className="size-2 rounded-full bg-destructive" />
                  ) : (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  )}
                  <span>{statusLabel}</span>
                </div>
                <h1 className="text-2xl font-semibold">
                  {activeThreadLabel ? "Draft in your last chat" : "Hello there!"}
                </h1>
                <p className="text-muted-foreground mt-2 max-w-xl text-xl">{statusDescription}</p>
                {activeThreadLabel ? (
                  <p className="text-muted-foreground/80 mt-3 max-w-xl text-xs">
                    Last active thread: {activeThreadLabel}
                  </p>
                ) : null}
                {error ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4 w-fit"
                    onClick={() => void onRetry()}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    Retry
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-background sticky bottom-0 mt-auto flex flex-col gap-3 overflow-visible rounded-t-(--composer-radius) pb-4 md:pb-6">
            <div className="mx-auto w-full max-w-(--thread-max-width)">
              <div className="border-border bg-background/95 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-xs backdrop-blur">
                {error ? (
                  <span className="size-2 rounded-full bg-destructive" />
                ) : (
                  <Loader2Icon className="size-3 animate-spin" />
                )}
                <span>{error ? "Transport unavailable" : "Transport warming up"}</span>
              </div>
            </div>
            <div
              data-slot="aui_composer-shell"
              className="bg-background flex w-full flex-col gap-2 rounded-(--composer-radius) border p-(--composer-padding) shadow-xs transition-shadow"
            >
              <textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                placeholder="Draft a message..."
                className="placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none"
                rows={1}
                autoFocus
                aria-label="Draft message"
              />
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full"
                  disabled
                  aria-label="Attachments unavailable while connecting"
                >
                  <PaperclipIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="size-8 rounded-full"
                  disabled
                  aria-label="Send unavailable while connecting"
                  title="Send is available when the Agent connection is ready"
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
