import type {
  CloudflareClientDevicesResponse,
  CloudflareNotificationPreferencesResponse,
} from "@/lib/workbench/workbench-types";
import { requestControlPlane } from "./transport";

export const getCloudflareClientDevices = () =>
  requestControlPlane<CloudflareClientDevicesResponse>("/workbench/devices");

export const registerCloudflareClientDevice = (input: {
  installationId: string;
  platform: "ios" | "android";
  token: string;
  appVersion: string;
}) =>
  requestControlPlane<CloudflareClientDevicesResponse>("/workbench/devices", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const revokeCloudflareClientDevice = (deviceId: string) =>
  requestControlPlane<CloudflareClientDevicesResponse>(
    `/workbench/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
  );

export const getCloudflareNotificationPreferences = () =>
  requestControlPlane<CloudflareNotificationPreferencesResponse>(
    "/workbench/notification-preferences",
  );

export const updateCloudflareNotificationPreferences = (input: {
  approvalRequired: boolean;
  terminalOutcomes: boolean;
}) =>
  requestControlPlane<CloudflareNotificationPreferencesResponse>(
    "/workbench/notification-preferences",
    { method: "PUT", body: JSON.stringify(input) },
  );
