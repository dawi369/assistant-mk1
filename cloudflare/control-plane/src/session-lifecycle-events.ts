type ThreadLifecycleTransition =
  | "create"
  | "activate"
  | "rename"
  | "archive"
  | "restore"
  | "delete"
  | "blocked";

type ThreadLifecycleControlEventInput = {
  transition: ThreadLifecycleTransition;
  threadId: string;
  activeThreadId?: string | null;
  replacementThreadId?: string | null;
  previousStatus?: string | null;
  nextStatus?: string | null;
  blockedAction?: Exclude<ThreadLifecycleTransition, "blocked">;
  reasonCode?: string;
  source?: "session-coordinator";
};

const eventTypeByTransition: Record<ThreadLifecycleTransition, string> = {
  create: "session.thread.created",
  activate: "session.thread.activated",
  rename: "session.thread.renamed",
  archive: "session.thread.archived",
  restore: "session.thread.restored",
  delete: "session.thread.deleted",
  blocked: "session.thread.blocked",
};

const summaryByTransition = (input: ThreadLifecycleControlEventInput) => {
  if (input.transition === "blocked") {
    return `Blocked ${input.blockedAction ?? "thread lifecycle"} while thread was unavailable.`;
  }
  if (input.transition === "create") return "Created chat thread.";
  if (input.transition === "activate") return "Activated chat thread.";
  if (input.transition === "rename") return "Renamed chat thread.";
  if (input.transition === "archive") return "Archived chat thread.";
  if (input.transition === "restore") return "Restored chat thread.";
  return "Soft-deleted chat thread.";
};

const compactData = (input: ThreadLifecycleControlEventInput) => {
  const data: Record<string, string> = {
    source: input.source ?? "session-coordinator",
    transition: input.transition,
  };
  if (input.activeThreadId) data.activeThreadId = input.activeThreadId;
  if (input.replacementThreadId) data.replacementThreadId = input.replacementThreadId;
  if (input.previousStatus) data.previousStatus = input.previousStatus;
  if (input.nextStatus) data.nextStatus = input.nextStatus;
  if (input.blockedAction) data.blockedAction = input.blockedAction;
  if (input.reasonCode) data.reasonCode = input.reasonCode;
  return data;
};

export const toThreadLifecycleControlPlaneEvent = (input: ThreadLifecycleControlEventInput) => ({
  type: eventTypeByTransition[input.transition],
  summary: summaryByTransition(input),
  targetType: "thread",
  targetId: input.threadId,
  data: compactData(input),
});
