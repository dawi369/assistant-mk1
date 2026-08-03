import type { Id } from "@/lib/workbench/core-contracts";
import type {
  CloudflareManagedStateResponse,
  CloudflareOperatorAlertsResponse,
  CloudflareTriggerDispatchesResponse,
  CloudflareTriggersResponse,
  CreateTriggerDispatchInput,
  CreateTriggerInput,
  UpdateTriggerInput,
} from "@/lib/workbench/workbench-types";
import { requestControlPlane } from "./transport";

export const getCloudflareTriggers = (limit = 50) =>
  requestControlPlane<CloudflareTriggersResponse>(
    `/triggers?limit=${encodeURIComponent(String(limit))}`,
  );

export const getCloudflareTrigger = (triggerId: Id) =>
  requestControlPlane<CloudflareTriggersResponse>(`/triggers/${encodeURIComponent(triggerId)}`);

export const createCloudflareTrigger = (input: CreateTriggerInput) =>
  requestControlPlane<CloudflareTriggersResponse>("/triggers", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateCloudflareTrigger = (triggerId: Id, input: UpdateTriggerInput) =>
  requestControlPlane<CloudflareTriggersResponse>(`/triggers/${encodeURIComponent(triggerId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

export const getCloudflareTriggerDispatches = (input?: { triggerId?: Id; limit?: number }) => {
  const params = new URLSearchParams();
  if (input?.triggerId) params.set("triggerId", input.triggerId);
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return requestControlPlane<CloudflareTriggerDispatchesResponse>(
    `/trigger-dispatches${query ? `?${query}` : ""}`,
  );
};

export const getCloudflareTriggerDispatch = (dispatchId: Id) =>
  requestControlPlane<CloudflareTriggerDispatchesResponse>(
    `/trigger-dispatches/${encodeURIComponent(dispatchId)}`,
  );

export const createCloudflareTriggerDispatch = (triggerId: Id, input: CreateTriggerDispatchInput) =>
  requestControlPlane<CloudflareTriggerDispatchesResponse>(
    `/triggers/${encodeURIComponent(triggerId)}/dispatches`,
    { method: "POST", body: JSON.stringify(input) },
  );

export const replayCloudflareTriggerDispatch = (dispatchId: Id) =>
  requestControlPlane<CloudflareTriggerDispatchesResponse>(
    `/trigger-dispatches/${encodeURIComponent(dispatchId)}/replay`,
    { method: "POST" },
  );

export const getCloudflareOperatorAlerts = (limit = 25) =>
  requestControlPlane<CloudflareOperatorAlertsResponse>(
    `/admin/operator-alerts?limit=${encodeURIComponent(String(limit))}`,
  );

export const updateCloudflareOperatorAlert = (alertId: Id, status: "acknowledged" | "resolved") =>
  requestControlPlane<CloudflareOperatorAlertsResponse>(
    `/admin/operator-alerts/${encodeURIComponent(alertId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );

export const retryCloudflareOperatorAlertDelivery = (alertId: Id) =>
  requestControlPlane<CloudflareOperatorAlertsResponse>(
    `/admin/operator-alerts/${encodeURIComponent(alertId)}/retry-delivery`,
    { method: "POST" },
  );

export const getCloudflareManagedState = (input?: {
  namespace?: string;
  type?: string;
  limit?: number;
}) => {
  const params = new URLSearchParams();
  if (input?.namespace) params.set("namespace", input.namespace);
  if (input?.type) params.set("type", input.type);
  if (input?.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return requestControlPlane<CloudflareManagedStateResponse>(
    `/workbench/managed-state${query ? `?${query}` : ""}`,
  );
};

export const getCloudflareManagedStateRecord = (stateId: Id) =>
  requestControlPlane<CloudflareManagedStateResponse>(
    `/workbench/managed-state/${encodeURIComponent(stateId)}`,
  );
