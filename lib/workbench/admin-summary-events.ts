export const workbenchSummaryRefreshEvent = "assistant-mk1:workbench-summary-refresh";

let refreshTimeout: number | null = null;

export const requestWorkbenchSummaryRefresh = (input: { immediate?: boolean } = {}) => {
  if (typeof window === "undefined") return;
  if (refreshTimeout) {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
  if (input.immediate) {
    window.dispatchEvent(new Event(workbenchSummaryRefreshEvent));
    return;
  }
  refreshTimeout = window.setTimeout(() => {
    refreshTimeout = null;
    window.dispatchEvent(new Event(workbenchSummaryRefreshEvent));
  }, 250);
};

export const flushWorkbenchSummaryRefresh = () => {
  if (typeof window === "undefined") return;
  if (refreshTimeout) {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }
  window.dispatchEvent(new Event(workbenchSummaryRefreshEvent));
};
