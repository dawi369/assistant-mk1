"use client";

import { useEffect, useRef } from "react";

import { sessionStreamReconnectPlan } from "@/lib/workbench/agent-connection/session-stream-policy";
import { browserWorkbenchRealtime } from "@/lib/workbench/browser-client";
import type { WorkbenchSessionEvent } from "@/lib/workbench/workbench-types";

export const useSessionEventStream = (input: {
  workspaceId?: string;
  onConnectedChange: (connected: boolean) => void;
  onEvent: (event: WorkbenchSessionEvent) => void;
}) => {
  const cursorRef = useRef<string | undefined>(undefined);
  const { onConnectedChange, onEvent, workspaceId } = input;

  useEffect(() => {
    if (!workspaceId) return;
    cursorRef.current = undefined;
    let closed = false;
    let subscription: ReturnType<typeof browserWorkbenchRealtime.subscribeSession> | null = null;
    let reconnectTimeout: number | null = null;
    const connect = async () => {
      if (closed) return;
      subscription = browserWorkbenchRealtime.subscribeSession({ after: cursorRef.current });
      let connected = false;
      let failed = false;
      try {
        for await (const event of subscription.events) {
          if (closed) break;
          if (!connected) {
            connected = true;
            onConnectedChange(true);
          }
          cursorRef.current = event.id;
          onEvent(event);
        }
      } catch (streamError) {
        failed = true;
        if (!closed) console.warn("Workbench session stream disconnected", streamError);
      } finally {
        if (!closed) {
          const reconnectPlan = sessionStreamReconnectPlan(failed);
          if (reconnectPlan.markDisconnected) onConnectedChange(false);
          subscription?.close();
          reconnectTimeout = window.setTimeout(() => void connect(), reconnectPlan.delayMs);
        }
      }
    };
    void connect();
    return () => {
      closed = true;
      onConnectedChange(false);
      subscription?.close();
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
    };
  }, [onConnectedChange, onEvent, workspaceId]);
};
