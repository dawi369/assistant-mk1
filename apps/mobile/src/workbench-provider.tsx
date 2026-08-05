import {
  createWorkbenchClient,
  createWorkbenchRealtimeAdapter,
} from "@assistant-mk1/workbench-client";
import { fetch as expoFetch } from "expo/fetch";
import { createContext, useContext, useMemo, type PropsWithChildren } from "react";

import { useMobileAuth } from "./auth/auth-provider";
import { mobileConfig } from "./config";

type ClientContext = {
  client: ReturnType<typeof createWorkbenchClient>;
  realtime: ReturnType<typeof createWorkbenchRealtimeAdapter>;
};

const WorkbenchContext = createContext<ClientContext | null>(null);

export function MobileWorkbenchProvider({ children }: PropsWithChildren) {
  const { getAccessToken } = useMobileAuth();
  const value = useMemo<ClientContext>(() => {
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
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export const useWorkbench = () => {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside MobileWorkbenchProvider");
  return context;
};
