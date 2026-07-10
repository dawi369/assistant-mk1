"use client";

import { createContext, useContext, type ReactNode } from "react";

type PackWorkflowContextValue = {
  openWorkflow: (workflowType: string) => void;
};

const PackWorkflowContext = createContext<PackWorkflowContextValue | null>(null);

export function PackWorkflowProvider({
  children,
  openWorkflow,
}: {
  children: ReactNode;
  openWorkflow: (workflowType: string) => void;
}) {
  return (
    <PackWorkflowContext.Provider value={{ openWorkflow }}>{children}</PackWorkflowContext.Provider>
  );
}

export const usePackWorkflow = () => useContext(PackWorkflowContext);
