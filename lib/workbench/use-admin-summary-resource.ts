"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  clearAdminSummaryResource,
  ensureAdminSummaryEventListener,
  getAdminSummarySnapshot,
  refreshAdminSummary,
  setAdminSummaryProjectionPreference,
  subscribeAdminSummary,
} from "./admin-summary-resource";
import type { WorkbenchSummaryRefreshSource } from "./admin-summary-events";
import type { AdminSummaryProjection } from "./admin-summary-projection";

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
    (
      input: {
        source?: WorkbenchSummaryRefreshSource;
        force?: boolean;
        projection?: AdminSummaryProjection;
      } = {},
    ) => refreshAdminSummary(input),
    [],
  );

  return {
    ...snapshot,
    refreshSummary,
    clearSummary: clearAdminSummaryResource,
    setProjectionPreference: setAdminSummaryProjectionPreference,
  };
};
