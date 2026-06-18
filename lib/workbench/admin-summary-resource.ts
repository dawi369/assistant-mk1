import {
  type WorkbenchSummaryRefreshDetail,
  type WorkbenchSummaryRefreshSource,
  workbenchSummaryRefreshEvent,
} from "./admin-summary-events";
import type { CloudflareAdminSummaryResponse } from "./workbench-types";

const adminSummaryPath = "/api/workbench/admin-summary";
const automatedRefreshCooldownMs = 900;
const emptyRefreshCounts: Record<WorkbenchSummaryRefreshSource, number> = {
  initial: 0,
  event: 0,
  manual: 0,
  "drawer-open": 0,
  "fallback-poll": 0,
};

export type AdminSummaryResourceSnapshot = {
  summary: CloudflareAdminSummaryResponse["summary"] | null;
  error: string | null;
  isLoading: boolean;
  lastLoadedAt: number | null;
  lastRefreshSource: WorkbenchSummaryRefreshSource | null;
  lastDurationMs: number | null;
  refreshCounts: Record<WorkbenchSummaryRefreshSource, number>;
};

type RefreshInput = {
  source?: WorkbenchSummaryRefreshSource;
  force?: boolean;
};

const initialSnapshot: AdminSummaryResourceSnapshot = {
  summary: null,
  error: null,
  isLoading: false,
  lastLoadedAt: null,
  lastRefreshSource: null,
  lastDurationMs: null,
  refreshCounts: emptyRefreshCounts,
};

let snapshot = initialSnapshot;
let inFlight: Promise<AdminSummaryResourceSnapshot> | null = null;
let scheduledRefresh: number | null = null;
let eventListenerAttached = false;
let latestRequestSequence = 0;
const listeners = new Set<() => void>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const notify = () => {
  for (const listener of listeners) listener();
};

const setSnapshot = (next: AdminSummaryResourceSnapshot) => {
  snapshot = next;
  notify();
};

const readJsonResponse = async (response: Response): Promise<CloudflareAdminSummaryResponse> => {
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const responseError = isRecord(body) ? body.error : undefined;
    const error =
      typeof responseError === "string"
        ? responseError
        : isRecord(responseError) && typeof responseError.message === "string"
          ? responseError.message
          : "Failed to load Cloudflare admin summary";
    throw new Error(error);
  }
  return body as CloudflareAdminSummaryResponse;
};

export const getAdminSummarySnapshot = () => snapshot;

export const clearAdminSummaryResource = () => {
  if (scheduledRefresh !== null && typeof window !== "undefined") {
    window.clearTimeout(scheduledRefresh);
  }
  scheduledRefresh = null;
  inFlight = null;
  latestRequestSequence += 1;
  setSnapshot(initialSnapshot);
};

export const refreshAdminSummary = async (
  input: RefreshInput = {},
): Promise<AdminSummaryResourceSnapshot> => {
  const source = input.source ?? "event";
  const now = Date.now();

  if (!input.force) {
    if (inFlight) return inFlight;
    if (snapshot.lastLoadedAt && now - snapshot.lastLoadedAt < automatedRefreshCooldownMs) {
      return snapshot;
    }
  }

  const requestSequence = latestRequestSequence + 1;
  latestRequestSequence = requestSequence;
  const refreshCounts = {
    ...snapshot.refreshCounts,
    [source]: snapshot.refreshCounts[source] + 1,
  };

  setSnapshot({
    ...snapshot,
    isLoading: true,
    error: null,
    lastRefreshSource: source,
    refreshCounts,
  });

  const startedAt = Date.now();
  const request = fetch(adminSummaryPath, { cache: "no-store" })
    .then(readJsonResponse)
    .then((body) => {
      const next = {
        summary: body.summary ?? null,
        error: null,
        isLoading: false,
        lastLoadedAt: Date.now(),
        lastRefreshSource: source,
        lastDurationMs: Date.now() - startedAt,
        refreshCounts,
      };
      if (requestSequence === latestRequestSequence) setSnapshot(next);
      return next;
    })
    .catch((error) => {
      const next = {
        ...snapshot,
        error: error instanceof Error ? error.message : "Failed to load admin summary",
        isLoading: false,
        lastRefreshSource: source,
        lastDurationMs: Date.now() - startedAt,
        refreshCounts,
      };
      if (requestSequence === latestRequestSequence) setSnapshot(next);
      return next;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });

  if (!input.force) inFlight = request;
  return request;
};

export const scheduleAdminSummaryRefresh = (input: RefreshInput = {}) => {
  if (typeof window === "undefined") return Promise.resolve(snapshot);
  if (input.force) return refreshAdminSummary(input);
  if (scheduledRefresh !== null) return Promise.resolve(snapshot);
  scheduledRefresh = window.setTimeout(() => {
    scheduledRefresh = null;
    void refreshAdminSummary(input);
  }, 0);
  return Promise.resolve(snapshot);
};

export const subscribeAdminSummary = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const ensureAdminSummaryEventListener = () => {
  if (typeof window === "undefined" || eventListenerAttached) return;
  eventListenerAttached = true;
  window.addEventListener(workbenchSummaryRefreshEvent, (event) => {
    const detail =
      "detail" in event && event.detail && typeof event.detail === "object"
        ? (event.detail as WorkbenchSummaryRefreshDetail)
        : {};
    void scheduleAdminSummaryRefresh({
      source: detail.source ?? "event",
      force: detail.force,
    });
  });
};

export const resetAdminSummaryResourceForTests = () => {
  snapshot = initialSnapshot;
  inFlight = null;
  scheduledRefresh = null;
  eventListenerAttached = false;
  listeners.clear();
};
