import {
  createWorkbenchClient,
  createWorkbenchRealtimeAdapter,
} from "@assistant-mk1/workbench-client";
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

type ClientContext = {
  client: ReturnType<typeof createWorkbenchClient>;
  resourceRevision: number;
  chatSelectionRevision: number;
  notifyChatSelectionChanged(): void;
};

const WorkbenchContext = createContext<ClientContext | null>(null);

export function MobileWorkbenchProvider({ children }: PropsWithChildren) {
  const { getAccessToken, state } = useMobileAuth();
  const [resourceRevision, setResourceRevision] = useState(0);
  const [chatSelectionRevision, setChatSelectionRevision] = useState(0);
  const cursorRef = useRef<string | undefined>(undefined);
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
  const notifyChatSelectionChanged = useCallback(() => {
    setChatSelectionRevision((revision) => revision + 1);
    setResourceRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (state !== "signed-in") {
      cursorRef.current = undefined;
      return;
    }
    let closed = false;
    let foreground = AppState.currentState === "active";
    let connecting = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let subscription: ReturnType<typeof clients.realtime.subscribeSession> | null = null;
    const connect = async () => {
      if (closed || !foreground || connecting) return;
      connecting = true;
      subscription = clients.realtime.subscribeSession({ after: cursorRef.current });
      try {
        for await (const event of subscription.events) {
          if (closed || !foreground) break;
          cursorRef.current = event.id;
          setResourceRevision((revision) => revision + 1);
          if (event.type === "session.thread.activated" || event.type === "session.agent.handoff") {
            setChatSelectionRevision((revision) => revision + 1);
          }
        }
      } catch {
        // Foreground reconnect below reauthenticates and resumes from the last cursor.
      } finally {
        connecting = false;
        subscription?.close();
        subscription = null;
        if (!closed && foreground) reconnectTimer = setTimeout(() => void connect(), 2_000);
      }
    };
    const appState = AppState.addEventListener("change", (next) => {
      foreground = next === "active";
      if (!foreground) {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        subscription?.close();
        return;
      }
      setResourceRevision((revision) => revision + 1);
      void connect();
    });
    void connect();
    return () => {
      closed = true;
      appState.remove();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      subscription?.close();
    };
  }, [clients.realtime, state]);

  const value = useMemo<ClientContext>(
    () => ({
      client: clients.client,
      resourceRevision,
      chatSelectionRevision,
      notifyChatSelectionChanged,
    }),
    [chatSelectionRevision, clients, notifyChatSelectionChanged, resourceRevision],
  );
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export const useWorkbench = () => {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside MobileWorkbenchProvider");
  return context;
};
