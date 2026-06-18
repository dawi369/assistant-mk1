"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  clearAdminSummaryResource,
  ensureAdminSummaryEventListener,
  getAdminSummarySnapshot,
  refreshAdminSummary,
  subscribeAdminSummary,
} from "./admin-summary-resource";
import type { WorkbenchSummaryRefreshSource } from "./admin-summary-events";

export const useAdminSummaryResource = () => {
  useEffect(() => {
    ensureAdminSummaryEventListener();
  }, []);

  const snapshot = useSyncExternalStore(
    subscribeAdminSummary,
    getAdminSummarySnapshot,
    getAdminSummarySnapshot,
  );

  const refreshSummary = useCallback(
    (input: { source?: WorkbenchSummaryRefreshSource; force?: boolean } = {}) =>
      refreshAdminSummary(input),
    [],
  );

  return {
    ...snapshot,
    refreshSummary,
    clearSummary: clearAdminSummaryResource,
  };
};
