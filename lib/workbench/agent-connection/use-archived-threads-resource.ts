"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatThreadSummary } from "@/lib/workbench/workbench-types";
import {
  archivedThreadsFreshMs,
  sessionPath,
  type ArchivedThreadsLoadInput,
} from "./session-runtime";

export const useArchivedThreadsResource = (input: { workspaceId?: string; preload: boolean }) => {
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const loadedAtRef = useRef(0);
  const loadedWorkspaceIdRef = useRef<string | null>(null);
  const currentWorkspaceIdRef = useRef<string | undefined>(input.workspaceId);
  const requestRef = useRef<{ workspaceId: string; promise: Promise<void> } | null>(null);
  currentWorkspaceIdRef.current = input.workspaceId;

  const load = useCallback(
    async (loadInput: ArchivedThreadsLoadInput = {}) => {
      const workspaceId = input.workspaceId;
      if (!workspaceId) return;
      const hasCurrentCache = loadedRef.current && loadedWorkspaceIdRef.current === workspaceId;
      const cacheIsFresh =
        hasCurrentCache && Date.now() - loadedAtRef.current < archivedThreadsFreshMs;
      if (!loadInput.force && cacheIsFresh) return;

      const activeRequest = requestRef.current;
      if (activeRequest?.workspaceId === workspaceId) return activeRequest.promise;

      if (!hasCurrentCache) setIsInitialLoading(true);
      setError(null);
      const request = (async () => {
        try {
          const response = await fetch(`${sessionPath}/threads?status=archived`, {
            cache: "no-store",
          });
          const body = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            threads?: ChatThreadSummary[];
            error?: string;
          };
          if (!response.ok || !body.ok) {
            throw new Error(body.error ?? "Failed to load archived chats");
          }
          if (currentWorkspaceIdRef.current !== workspaceId) return;
          setThreads(body.threads ?? []);
          loadedRef.current = true;
          loadedAtRef.current = Date.now();
          loadedWorkspaceIdRef.current = workspaceId;
        } catch (nextError) {
          if (currentWorkspaceIdRef.current === workspaceId) {
            setError(
              nextError instanceof Error ? nextError.message : "Failed to load archived chats",
            );
          }
          throw nextError;
        } finally {
          if (requestRef.current?.workspaceId === workspaceId) requestRef.current = null;
          if (currentWorkspaceIdRef.current === workspaceId) setIsInitialLoading(false);
        }
      })();
      requestRef.current = { workspaceId, promise: request };
      return request;
    },
    [input.workspaceId],
  );

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const refreshIfLoaded = useCallback(() => {
    loadedAtRef.current = 0;
    if (!loadedRef.current) return;
    void loadRef.current({ force: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const cachedWorkspaceId = loadedWorkspaceIdRef.current;
    if (input.workspaceId && (!cachedWorkspaceId || cachedWorkspaceId === input.workspaceId)) {
      return;
    }
    loadedRef.current = false;
    loadedAtRef.current = 0;
    loadedWorkspaceIdRef.current = null;
    setThreads([]);
    setError(null);
  }, [input.workspaceId]);

  useEffect(() => {
    if (!input.preload) return;
    const timeout = window.setTimeout(() => void load().catch(() => undefined), 250);
    return () => window.clearTimeout(timeout);
  }, [input.preload, load]);

  useEffect(() => {
    const refreshVisibleCache = () => {
      if (document.visibilityState !== "visible" || !loadedRef.current) return;
      void load().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refreshVisibleCache);
    window.addEventListener("focus", refreshVisibleCache);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisibleCache);
      window.removeEventListener("focus", refreshVisibleCache);
    };
  }, [load]);

  return {
    archivedThreads: threads,
    setArchivedThreads: setThreads,
    isLoadingArchivedThreads: isInitialLoading,
    archivedThreadsError: error,
    loadArchivedThreads: load,
    refreshArchivedThreadsIfLoaded: refreshIfLoaded,
  };
};
