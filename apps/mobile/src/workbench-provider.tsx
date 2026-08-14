import {
  createWorkbenchClient,
  createWorkbenchRealtimeAdapter,
  type ChatSessionResponse,
  type WorkbenchSessionEvent,
} from "@assistant-mk1/workbench-client";
import {
  WorkbenchClientProvider,
  invalidateWorkbenchQueries,
  useWorkbenchQueryClient,
  workbenchQueryKeys,
  workbenchSessionEventInvalidations,
} from "@assistant-mk1/workbench-react";
import { fetch as expoFetch } from "expo/fetch";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";

import { useMobileAuth } from "./auth/auth-provider";
import { mobileConfig } from "./config";
import { mobileStore } from "./storage/mobile-store";

type ClientContext = {
  client: ReturnType<typeof createWorkbenchClient>;
  chatSelectionRevision: number;
  realtimeState: "idle" | "connecting" | "connected" | "reconnecting";
  notifyChatSelectionChanged(): void;
  subscribeSessionEvents(listener: (event: WorkbenchSessionEvent) => void): () => void;
};

const WorkbenchContext = createContext<ClientContext | null>(null);

const publishSession = (
  queryClient: ReturnType<typeof useWorkbenchQueryClient>,
  session: ChatSessionResponse,
) => {
  const workspaceId = session.workspace?.id;
  queryClient.setQueryData(workbenchQueryKeys.session(), session);
  if (!workspaceId) return;
  queryClient.setQueryData(workbenchQueryKeys.session(workspaceId), session);
  queryClient.setQueryData(workbenchQueryKeys.threads(workspaceId, "active"), {
    ok: true,
    status: "active",
    threads: session.threads ?? [],
  });
};

function MobileWorkbenchRuntime({
  children,
  client,
  realtime,
  authState,
}: PropsWithChildren<{
  client: ReturnType<typeof createWorkbenchClient>;
  realtime: ReturnType<typeof createWorkbenchRealtimeAdapter>;
  authState: ReturnType<typeof useMobileAuth>["state"];
}>) {
  const queryClient = useWorkbenchQueryClient();
  const [chatSelectionRevision, setChatSelectionRevision] = useState(0);
  const [realtimeState, setRealtimeState] = useState<ClientContext["realtimeState"]>("idle");
  const workspaceIdRef = useRef<string | null>(null);
  const sessionEventListenersRef = useRef(new Set<(event: WorkbenchSessionEvent) => void>());

  const notifyChatSelectionChanged = useCallback(() => {
    setChatSelectionRevision((revision) => revision + 1);
    const workspaceId = workspaceIdRef.current;
    void invalidateWorkbenchQueries(queryClient, [
      workbenchQueryKeys.session(workspaceId),
      workbenchQueryKeys.threads(workspaceId, "active"),
      workbenchQueryKeys.threads(workspaceId, "archived"),
    ]);
  }, [queryClient]);

  useEffect(() => {
    if (authState !== "signed-in") {
      workspaceIdRef.current = null;
      setRealtimeState("idle");
      return;
    }
    let closed = false;
    let foreground = AppState.currentState === "active";
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let subscription: ReturnType<typeof realtime.subscribeSession> | null = null;

    const scheduleReconnect = () => {
      if (closed || !foreground) return;
      attempt += 1;
      setRealtimeState("reconnecting");
      const ceiling = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
      const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
      reconnectTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (closed || !foreground || subscription) return;
      setRealtimeState(attempt ? "reconnecting" : "connecting");
      try {
        const session = await client.session.get({ source: "mobile-realtime-bootstrap" });
        if (closed || !foreground) return;
        publishSession(queryClient, session);
        const workspaceId = session.workspace?.id ?? null;
        workspaceIdRef.current = workspaceId;
        const after = workspaceId
          ? ((await mobileStore.getSessionCursor(workspaceId)) ?? undefined)
          : undefined;
        subscription = realtime.subscribeSession({ after });
        setRealtimeState("connected");
        attempt = 0;
        for await (const event of subscription.events) {
          if (closed || !foreground) break;
          if (workspaceId) await mobileStore.putSessionCursor(workspaceId, event.id);
          sessionEventListenersRef.current.forEach((listener) => listener(event));
          await invalidateWorkbenchQueries(
            queryClient,
            workbenchSessionEventInvalidations(event, workspaceId),
          );
          if (event.type === "session.thread.activated" || event.type === "session.agent.handoff") {
            setChatSelectionRevision((revision) => revision + 1);
          }
        }
      } catch {
        // The bounded reconnect below reauthenticates and resumes from the persisted cursor.
      } finally {
        subscription?.close();
        subscription = null;
        scheduleReconnect();
      }
    };

    const appState = AppState.addEventListener("change", (next) => {
      foreground = next === "active";
      if (!foreground) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        subscription?.close();
        subscription = null;
        setRealtimeState("idle");
        return;
      }
      void connect();
      void queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.tenant(workspaceIdRef.current),
      });
    });
    void connect();
    return () => {
      closed = true;
      appState.remove();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      subscription?.close();
    };
  }, [authState, client, queryClient, realtime]);

  const value = useMemo<ClientContext>(
    () => ({
      client,
      chatSelectionRevision,
      realtimeState,
      notifyChatSelectionChanged,
      subscribeSessionEvents(listener) {
        sessionEventListenersRef.current.add(listener);
        return () => sessionEventListenersRef.current.delete(listener);
      },
    }),
    [chatSelectionRevision, client, notifyChatSelectionChanged, realtimeState],
  );
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function MobileWorkbenchProvider({ children }: PropsWithChildren) {
  const { getAccessToken, state } = useMobileAuth();
  const clients = useMemo(() => {
    const options = {
      baseUrl: mobileConfig.workbenchOrigin,
      client: { platform: mobileConfig.platform, version: mobileConfig.version },
      fetch: expoFetch as typeof globalThis.fetch,
      getAccessToken,
    };
    return {
      client: createWorkbenchClient(options),
      realtime: createWorkbenchRealtimeAdapter(options),
    };
  }, [getAccessToken]);
  return (
    <WorkbenchClientProvider client={clients.client}>
      <MobileWorkbenchRuntime client={clients.client} realtime={clients.realtime} authState={state}>
        {children}
      </MobileWorkbenchRuntime>
    </WorkbenchClientProvider>
  );
}

export const useWorkbench = () => {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside MobileWorkbenchProvider");
  return context;
};
