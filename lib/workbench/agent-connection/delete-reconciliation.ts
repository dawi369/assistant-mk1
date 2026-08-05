type ThreadIdentity = { threadId: string };

type SessionThreadLookup = {
  activeThread?: ThreadIdentity | null;
  threads?: ThreadIdentity[] | null;
};

export const sessionContainsThread = (session: SessionThreadLookup, threadId: string) =>
  session.activeThread?.threadId === threadId ||
  (session.threads ?? []).some((thread) => thread.threadId === threadId);
