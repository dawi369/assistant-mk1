"use client";

import { useState } from "react";

import { Assistant } from "@/app/assistant";
import { AuthButton } from "@/components/auth/auth-button";
import { DevMonitorDrawer } from "@/components/workbench/dev-monitor-drawer";

export function WorkbenchShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="bg-background relative h-dvh overflow-hidden">
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <AuthButton />
        <DevMonitorDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </div>

      <Assistant />
    </div>
  );
}
