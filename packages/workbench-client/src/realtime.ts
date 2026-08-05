import type { WorkbenchSessionEvent } from "./contracts/index.js";

export type SessionSubscriptionInput = {
  after?: string;
  signal?: AbortSignal;
};

export type SessionSubscription = {
  close(): void;
  events: AsyncIterable<WorkbenchSessionEvent>;
};

export type WorkbenchRealtimeAdapter = {
  subscribeSession(input?: SessionSubscriptionInput): SessionSubscription;
};
