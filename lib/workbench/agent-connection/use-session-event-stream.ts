"use client";

import { useEffect, useRef } from "react";

import { shouldRefreshThreadsAfterSessionStreamOpen } from "@/lib/workbench/chat-session-state";
import type { WorkbenchSessionEvent } from "@/lib/workbench/workbench-types";
import { sessionEventTypes } from "./session-runtime";

export const useSessionEventStream = (input: {
  workspaceId?: string;
  onConnectedChange: (connected: boolean) => void;
  onEvent: (event: WorkbenchSessionEvent) => void;
  onRefreshRecommended: () => void;
}) => {
  const openedRef = useRef(false);

  useEffect(() => {
    if (!input.workspaceId) return;
    let closed = false;
    let source: EventSource | null = null;
    let reconnectTimeout: number | null = null;
    const connect = () => {
      if (closed) return;
      source = new EventSource("/api/workbench/chat-session/stream");
      source.onopen = () => {
        input.onConnectedChange(true);
        const shouldRefresh = shouldRefreshThreadsAfterSessionStreamOpen(openedRef.current);
        openedRef.current = true;
        if (shouldRefresh) input.onRefreshRecommended();
      };
      const onEvent = (message: MessageEvent<string>) => {
        try {
          input.onEvent(JSON.parse(message.data) as WorkbenchSessionEvent);
        } catch (parseError) {
          console.warn("Failed to parse Workbench session event", parseError);
        }
      };
      for (const type of sessionEventTypes) source.addEventListener(type, onEvent as EventListener);
      source.onerror = () => {
        input.onConnectedChange(false);
        source?.close();
        if (!closed) reconnectTimeout = window.setTimeout(connect, 2_000);
      };
    };
    connect();
    return () => {
      closed = true;
      input.onConnectedChange(false);
      source?.close();
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
    };
  }, [input]);
};
