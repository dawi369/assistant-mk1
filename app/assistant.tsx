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
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useAgent } from "agents/react";
import {
  ArrowUpIcon,
  Loader2Icon,
  LockKeyholeIcon,
  LogInIcon,
  PaperclipIcon,
  RefreshCwIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Thread } from "@/components/assistant-ui/thread";
import {
  StarterSuggestionGrid,
  ThreadWelcomeLayout,
} from "@/components/assistant-ui/thread-welcome";
import { useWorkbenchComposerFocus } from "@/components/workbench/composer-focus-context";
import { authPresentationCookieName } from "@/lib/workbench/auth-presentation";
import { hasPendingActiveThread } from "@/lib/workbench/chat-session-state";
import { sendQueuedDraftWhenReady } from "@/lib/workbench/runtime-draft-handoff";
import { hasWorkbenchSessionAccess } from "@/lib/workbench/session-access";
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

const writeSignedOutPresentation = (isSignedOut: boolean) => {
  if (typeof window === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = isSignedOut
    ? `${authPresentationCookieName}=signed-out; Path=/; Max-Age=2592000; SameSite=Lax${secure}`
    : `${authPresentationCookieName}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
};

export function Assistant({
  children,
  initialSignedOutPresentation = false,
}: {
  children?: ReactNode;
  initialSignedOutPresentation?: boolean;
}) {
  const {
    connection,
    error,
    isLocalNewSession,
    materializeTurn,
    pending,
    retry,
    session,
    stageNewSession,
  } = useWorkbenchAgentConnection();
  const [preRuntimeDraft, setPreRuntimeDraft] = useState("");
  const clearPreRuntimeDraft = useCallback(() => setPreRuntimeDraft(""), []);
  const [queuedFirstSendDraft, setQueuedFirstSendDraft] = useState<string | null>(null);
  const clearQueuedFirstSendDraft = useCallback(() => setQueuedFirstSendDraft(null), []);
  const [isSubmittingLocalTurn, setIsSubmittingLocalTurn] = useState(false);
  const handlePreRuntimeDraftChange = useCallback(
    (nextDraft: string) => {
      setPreRuntimeDraft(nextDraft);
      if (isLocalNewSession && nextDraft.trim()) {
        void stageNewSession("first-draft");
      }
    },
    [isLocalNewSession, stageNewSession],
  );
  const handlePreRuntimeFocus = useCallback(() => {
    if (isLocalNewSession) void stageNewSession("first-focus");
  }, [isLocalNewSession, stageNewSession]);
  const submitLocalTurn = useCallback(
    async (draftOverride?: string) => {
      const draft = draftOverride ?? preRuntimeDraft;
      if (!isLocalNewSession || isSubmittingLocalTurn || !draft.trim()) return;
      setIsSubmittingLocalTurn(true);
      setQueuedFirstSendDraft(draft);
      try {
        const staged = await stageNewSession("first-send");
        if (!staged?.connection) {
          setQueuedFirstSendDraft(null);
          await materializeTurn(draft);
          clearPreRuntimeDraft();
        }
      } finally {
        setIsSubmittingLocalTurn(false);
      }
    },
    [
      clearPreRuntimeDraft,
      isLocalNewSession,
      isSubmittingLocalTurn,
      materializeTurn,
      preRuntimeDraft,
      stageNewSession,
    ],
  );
  const submitStarterPrompt = useCallback(
    async (prompt: string) => {
      setPreRuntimeDraft(prompt);
      await submitLocalTurn(prompt);
    },
    [submitLocalTurn],
  );

  if (!connection || hasPendingActiveThread(session)) {
    return (
      <PreRuntimeDraftSurface
        draft={preRuntimeDraft}
        error={error}
        isLocalNewSession={isLocalNewSession}
        isSubmitting={isSubmittingLocalTurn || pending?.type === "materialize"}
        onDraftChange={handlePreRuntimeDraftChange}
        onFocus={handlePreRuntimeFocus}
        onSubmit={submitLocalTurn}
        onStarterPrompt={submitStarterPrompt}
        onRetry={retry}
        session={session}
        initialSignedOutPresentation={initialSignedOutPresentation}
      />
    );
  }

  return (
    <AgentRuntime
      key={`${connection.threadId ?? connection.instanceName}:${connection.agentId ?? "agent"}`}
      connection={connection}
      draft={preRuntimeDraft}
      queuedDraft={queuedFirstSendDraft}
      onDraftHydrated={clearPreRuntimeDraft}
      onQueuedDraftSent={clearQueuedFirstSendDraft}
    >
      {children}
      <Thread />
    </AgentRuntime>
  );
}

function AgentRuntime({
  connection,
  draft,
  queuedDraft,
  onDraftHydrated,
  onQueuedDraftSent,
  children,
}: {
  connection: WorkbenchAgentConnection;
  draft: string;
  queuedDraft: string | null;
  onDraftHydrated: () => void;
  onQueuedDraftSent: () => void;
  children?: ReactNode;
}) {
  const hostOptions = useMemo(
    () => toAgentHostOptions(connection.agentHost!),
    [connection.agentHost],
  );

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
      <RuntimeDraftHandoff
        connectionReady={agent.ready}
        draft={draft}
        queuedDraft={queuedDraft}
        onHydrated={onDraftHydrated}
        onQueuedDraftSent={onQueuedDraftSent}
      />
      <div className="relative h-full">{children}</div>
    </AssistantRuntimeProvider>
  );
}

function RuntimeDraftHandoff({
  connectionReady,
  draft,
  queuedDraft,
  onHydrated,
  onQueuedDraftSent,
}: {
  connectionReady: Promise<void>;
  draft: string;
  queuedDraft: string | null;
  onHydrated: () => void;
  onQueuedDraftSent: () => void;
}) {
  const aui = useAui();
  const attemptedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    const targetDraft = queuedDraft?.trim() ? queuedDraft : draft;
    const shouldSend = Boolean(queuedDraft?.trim());
    const attemptKey = `${shouldSend ? "send" : "hydrate"}:${targetDraft}`;
    if (!targetDraft || attemptedDraftRef.current === attemptKey) return;

    const composer = aui.composer();
    const currentText = composer.getState().text ?? "";
    attemptedDraftRef.current = attemptKey;

    if (currentText && currentText !== targetDraft) return;
    if (currentText !== targetDraft) {
      composer.setText(targetDraft);
    }

    if (shouldSend) {
      let cancelled = false;
      void sendQueuedDraftWhenReady({
        connectionReady,
        draft: targetDraft,
        getComposer: () => aui.composer(),
        isCancelled: () => cancelled,
      })
        .then((sent) => {
          if (sent) {
            onQueuedDraftSent();
            onHydrated();
          }
        })
        .catch(() => {
          attemptedDraftRef.current = null;
        });
      return () => {
        cancelled = true;
      };
    }

    if (currentText === targetDraft) {
      onHydrated();
      return;
    }
    onHydrated();
  }, [aui, connectionReady, draft, onHydrated, onQueuedDraftSent, queuedDraft]);

  return null;
}

function PreRuntimeDraftSurface({
  draft,
  error,
  isLocalNewSession,
  isSubmitting,
  onDraftChange,
  onFocus,
  onSubmit,
  onStarterPrompt,
  onRetry,
  session,
  initialSignedOutPresentation,
}: {
  draft: string;
  error: string | null;
  isLocalNewSession: boolean;
  isSubmitting: boolean;
  onDraftChange: (draft: string) => void;
  onFocus: () => void;
  onSubmit: () => Promise<void>;
  onStarterPrompt: (prompt: string) => Promise<void>;
  onRetry: () => Promise<void>;
  session: ReturnType<typeof useWorkbenchAgentConnection>["session"];
  initialSignedOutPresentation: boolean;
}) {
  const { registerComposerInput } = useWorkbenchComposerFocus();
  const { user, loading: authLoading, refreshAuth } = useAuth();
  const [hasRememberedSignOut, setHasRememberedSignOut] = useState(initialSignedOutPresentation);
  const hasSessionAccess = hasWorkbenchSessionAccess({
    hasWorkOsUser: Boolean(user),
    session,
    sessionError: error,
  });
  const activeThreadLabel = session?.activeThread?.title || session?.activeThread?.threadId;
  const hasCachedShell = session?.isStale === true;
  const isRestoringSession = authLoading && !hasRememberedSignOut && !hasSessionAccess;
  const isCreatingThread = hasPendingActiveThread(session);
  const visibleError = isLocalNewSession ? null : error;
  const statusLabel = visibleError
    ? "Connection failed"
    : isLocalNewSession
      ? null
      : isCreatingThread
        ? "Creating new chat"
        : "Connecting to Cloudflare Agent";
  const statusDescription = visibleError
    ? visibleError
    : isLocalNewSession
      ? null
      : isCreatingThread
        ? "You can draft while Cloudflare creates the Agent session."
        : hasCachedShell
          ? "Cached workspace is visible while the live Agent token refreshes."
          : "You can start drafting while the Agent connection opens.";

  useEffect(() => {
    if (authLoading) return;
    const isSignedOut = !hasSessionAccess;
    writeSignedOutPresentation(isSignedOut);
    setHasRememberedSignOut(isSignedOut);
  }, [authLoading, hasSessionAccess]);

  if (!hasSessionAccess) {
    return (
      <div className="aui-root aui-thread-root bg-background @container flex h-full flex-col">
        <div className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth">
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8 sm:px-10">
            <section
              className="my-auto w-full border-l-2 border-foreground/15 py-2 pl-5"
              aria-labelledby="signed-out-title"
            >
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                <LockKeyholeIcon className="size-3.5" />
                {isRestoringSession ? "Secure session" : "Workspace access required"}
              </div>
              <h1 id="signed-out-title" className="mt-5 text-3xl font-semibold tracking-normal">
                {isRestoringSession ? "Restoring your workspace" : "Sign in to resume your work"}
              </h1>
              <p className="text-muted-foreground mt-3 max-w-lg text-base leading-6">
                {isRestoringSession
                  ? "Checking your signed-in session before opening workspace data."
                  : "Chats, agents, and workspace history are available after you sign in."}
              </p>
              {isRestoringSession ? (
                <div className="text-muted-foreground mt-6 flex items-center gap-2 text-sm">
                  <Loader2Icon className="size-4 animate-spin" />
                  Verifying access
                </div>
              ) : (
                <Button
                  type="button"
                  className="mt-6"
                  onClick={() => void refreshAuth({ ensureSignedIn: true })}
                >
                  <LogInIcon className="size-4" />
                  Sign in
                </Button>
              )}
              <p className="text-muted-foreground mt-5 text-xs">
                {isRestoringSession
                  ? "Workspace content stays hidden until access is confirmed."
                  : "Your workspace opens after authentication completes."}
              </p>
            </section>
          </div>
        </div>
      </div>
    );
  }

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
          {isLocalNewSession ? (
            <ThreadWelcomeLayout>
              <StarterSuggestionGrid disabled={isSubmitting} onSelect={onStarterPrompt} />
            </ThreadWelcomeLayout>
          ) : (
            <div className="my-auto flex grow flex-col">
              <div className="flex w-full grow flex-col items-center justify-center">
                <div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex size-full flex-col justify-center px-4 duration-200">
                  {statusLabel ? (
                    <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                      {visibleError ? (
                        <span className="size-2 rounded-full bg-destructive" />
                      ) : (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      )}
                      <span>{statusLabel}</span>
                    </div>
                  ) : null}
                  <h1 className="text-2xl font-semibold">
                    {activeThreadLabel ? "Draft in your last chat" : "Hello there!"}
                  </h1>
                  {statusDescription ? (
                    <p className="text-muted-foreground mt-2 max-w-xl text-xl">
                      {statusDescription}
                    </p>
                  ) : null}
                  {activeThreadLabel ? (
                    <p className="text-muted-foreground/80 mt-3 max-w-xl text-xs">
                      Last active thread: {activeThreadLabel}
                    </p>
                  ) : null}
                  {visibleError ? (
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
          )}

          <div className="bg-background sticky bottom-0 mt-auto flex flex-col overflow-visible rounded-t-(--composer-radius) pb-4 md:pb-6">
            <div
              data-slot="aui_composer-shell"
              className="bg-background flex w-full flex-col gap-2 rounded-(--composer-radius) border p-(--composer-padding) shadow-xs transition-shadow"
            >
              <textarea
                ref={registerComposerInput}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onFocus={onFocus}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  void onSubmit();
                }}
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
                  aria-label="Attachments unavailable before the first message"
                >
                  <PaperclipIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="icon"
                  className="size-8 rounded-full"
                  disabled={!isLocalNewSession || isSubmitting || !draft.trim()}
                  aria-label={
                    isLocalNewSession ? "Send message" : "Send unavailable while connecting"
                  }
                  title={
                    isLocalNewSession
                      ? "Create the chat and send this message"
                      : "Send is available when the Agent connection is ready"
                  }
                  onClick={() => void onSubmit()}
                >
                  {isSubmitting ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <ArrowUpIcon className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
