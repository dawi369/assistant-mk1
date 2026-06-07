export const workbenchSummaryRefreshEvent = "assistant-mk1:workbench-summary-refresh";

export const requestWorkbenchSummaryRefresh = () => {
  window.dispatchEvent(new Event(workbenchSummaryRefreshEvent));
};
