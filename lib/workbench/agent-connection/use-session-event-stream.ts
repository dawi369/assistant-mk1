"use client";

import { useEffect, useRef } from "react";

import { shouldRefreshThreadsAfterSessionStreamOpen } from "@/lib/workbench/chat-session-state";
import { browserWorkbenchRealtime } from "@/lib/workbench/browser-client";
import type { WorkbenchSessionEvent } from "@/lib/workbench/workbench-types";

export const useSessionEventStream = (input: {
  workspaceId?: string;
  onConnectedChange: (connected: boolean) => void;
  onEvent: (event: WorkbenchSessionEvent) => void;
  onRefreshRecommended: () => void;
}) => {
  const openedRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const { onConnectedChange, onEvent, onRefreshRecommended, workspaceId } = input;

  useEffect(() => {
    if (!workspaceId) return;
    cursorRef.current = undefined;
    openedRef.current = false;
    let closed = false;
    let subscription: ReturnType<typeof browserWorkbenchRealtime.subscribeSession> | null = null;
    let reconnectTimeout: number | null = null;
    const connect = async () => {
      if (closed) return;
      subscription = browserWorkbenchRealtime.subscribeSession({ after: cursorRef.current });
      let connected = false;
      try {
        for await (const event of subscription.events) {
          if (closed) break;
          if (!connected) {
            connected = true;
            onConnectedChange(true);
            const shouldRefresh = shouldRefreshThreadsAfterSessionStreamOpen(openedRef.current);
            openedRef.current = true;
            if (shouldRefresh) onRefreshRecommended();
          }
          cursorRef.current = event.id;
          onEvent(event);
        }
      } catch (streamError) {
        if (!closed) console.warn("Workbench session stream disconnected", streamError);
      } finally {
        if (!closed) {
          onConnectedChange(false);
          subscription?.close();
          reconnectTimeout = window.setTimeout(() => void connect(), 2_000);
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
  }, [onConnectedChange, onEvent, onRefreshRecommended, workspaceId]);
};
