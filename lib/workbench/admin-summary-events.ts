export const workbenchSummaryRefreshEvent = "assistant-mk1:workbench-summary-refresh";

export type WorkbenchSummaryRefreshSource =
  | "initial"
  | "event"
  | "manual"
  | "drawer-open"
  | "fallback-poll";

export type WorkbenchSummaryRefreshDetail = {
  source?: WorkbenchSummaryRefreshSource;
  force?: boolean;
};

let refreshTimeout: number | null = null;
let pendingDetail: WorkbenchSummaryRefreshDetail = {};

const dispatchSummaryRefresh = (detail: WorkbenchSummaryRefreshDetail) => {
  window.dispatchEvent(new CustomEvent(workbenchSummaryRefreshEvent, { detail }));
};

export const requestWorkbenchSummaryRefresh = (
  input: { immediate?: boolean } & WorkbenchSummaryRefreshDetail = {},
) => {
  if (typeof window === "undefined") return;
  pendingDetail = {
    source: input.source ?? pendingDetail.source ?? "event",
    force: Boolean(input.force || pendingDetail.force),
  };
  if (refreshTimeout) {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
  if (input.immediate) {
    const detail = pendingDetail;
    pendingDetail = {};
    dispatchSummaryRefresh(detail);
    return;
  }
  refreshTimeout = window.setTimeout(() => {
    refreshTimeout = null;
    const detail = pendingDetail;
    pendingDetail = {};
    dispatchSummaryRefresh(detail);
  }, 250);
};

export const flushWorkbenchSummaryRefresh = () => {
  if (typeof window === "undefined") return;
  if (refreshTimeout) {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
  const detail = pendingDetail;
  pendingDetail = {};
  dispatchSummaryRefresh(detail);
};
