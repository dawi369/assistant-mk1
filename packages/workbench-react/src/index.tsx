import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { createContext, createElement, useContext, useState, type ReactNode } from "react";

import type { WorkbenchClient } from "@assistant-mk1/workbench-client";

const ClientContext = createContext<WorkbenchClient | null>(null);

export const workbenchQueryKeys = {
  session: ["workbench", "session"] as const,
  threads: (status: "active" | "archived") => ["workbench", "threads", status] as const,
  agents: ["workbench", "agents"] as const,
  workspaces: ["workbench", "workspaces"] as const,
  runs: ["workbench", "history", "runs"] as const,
  artifacts: ["workbench", "history", "artifacts"] as const,
  approvals: ["workbench", "approvals"] as const,
  connections: ["workbench", "connections"] as const,
  actions: ["workbench", "actions"] as const,
} as const;

export const createWorkbenchQueryClient = (config: QueryClientConfig = {}) =>
  new QueryClient({
    ...config,
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000, ...config.defaultOptions?.queries },
      mutations: { retry: false, ...config.defaultOptions?.mutations },
    },
  });

export function WorkbenchClientProvider({
  client,
  queryClient,
  children,
}: {
  client: WorkbenchClient;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [ownedQueryClient] = useState(() => queryClient ?? createWorkbenchQueryClient());
  return createElement(
    ClientContext.Provider,
    { value: client },
    createElement(QueryClientProvider, { client: ownedQueryClient }, children),
  );
}

export const useWorkbenchClient = () => {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useWorkbenchClient must be used inside WorkbenchClientProvider");
  return client;
};

export const useWorkbenchSession = () => {
  const client = useWorkbenchClient();
  return useQuery({ queryKey: workbenchQueryKeys.session, queryFn: () => client.session.get() });
};

export const useWorkbenchThreads = (status: "active" | "archived" = "active") => {
  const client = useWorkbenchClient();
  return useQuery({
    queryKey: workbenchQueryKeys.threads(status),
    queryFn: () => client.threads.list(status),
  });
};

export const useWorkbenchAgents = (enabled = true) => {
  const client = useWorkbenchClient();
  return useQuery({
    queryKey: workbenchQueryKeys.agents,
    queryFn: () => client.agents.list(),
    enabled,
  });
};

export const useWorkbenchRuns = () => {
  const client = useWorkbenchClient();
  return useQuery({ queryKey: workbenchQueryKeys.runs, queryFn: () => client.history.listRuns() });
};

export const useWorkbenchApprovals = () => {
  const client = useWorkbenchClient();
  return useQuery({
    queryKey: workbenchQueryKeys.approvals,
    queryFn: () => client.approvals.list(),
  });
};

export const useWorkbenchConnections = () => {
  const client = useWorkbenchClient();
  return useQuery({
    queryKey: workbenchQueryKeys.connections,
    queryFn: () => client.connections.list(),
  });
};

export const useRunWorkflow = () => {
  const client = useWorkbenchClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workflowType: string;
      input?: Record<string, unknown>;
      executionMode?: "dry_run";
    }) => client.workflows.run(input.workflowType, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workbenchQueryKeys.runs });
    },
  });
};

export type { WorkbenchClient } from "@assistant-mk1/workbench-client";
