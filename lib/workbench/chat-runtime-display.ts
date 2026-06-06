import type { ChatRuntimeSummary } from "@/lib/workbench/workbench-types";

export const chatRuntimeStateLabel = (state?: ChatRuntimeSummary["state"] | null) => {
  switch (state) {
    case "no_session":
    case "no_thread":
      return "No chat yet";
    case "thread_ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    default:
      return "Loading";
  }
};

export const chatRuntimeStateTone = (state?: ChatRuntimeSummary["state"] | null) => {
  switch (state) {
    case "thread_ready":
    case "completed":
      return "completed";
    case "running":
      return "running";
    case "blocked":
    case "failed":
      return "failed";
    default:
      return undefined;
  }
};
