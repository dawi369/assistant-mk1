"use client";

import { useState } from "react";

import { Assistant } from "@/app/assistant";
import { AuthButton } from "@/components/auth/auth-button";
import { DevMonitorDrawer } from "@/components/workbench/dev-monitor-drawer";
import { WorkbenchRuntimeHint } from "@/components/workbench/workbench-runtime-hint";

export function WorkbenchShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="bg-background relative h-dvh overflow-hidden">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <WorkbenchRuntimeHint onOpenMonitor={() => setDrawerOpen(true)} />
        <AuthButton />
        <DevMonitorDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </div>

      <Assistant />
    </div>
  );
}
