import type { WorkbenchClient } from "@assistant-mk1/workbench-client";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, type PropsWithChildren } from "react";

import { useMobileAuth } from "../auth/auth-provider";
import { mobileConfig } from "../config";
import { mobileStore } from "../storage/mobile-store";

const installationKey = "notification.installation-id";
const deviceKey = "notification.device-id";

const installationId = async () => {
  const existing = await mobileStore.getSetting(installationKey);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await mobileStore.putSetting(installationKey, created);
  return created;
};

export const registerDeviceDelivery = async (client: WorkbenchClient) => {
  if (!Device.isDevice) return null;
  const projectId = mobileConfig.easProjectId || Constants.easConfig?.projectId;
  if (!projectId) return null;
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.status === "granted" ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const response = await client.devices.register({
    installationId: await installationId(),
    platform: mobileConfig.platform,
    token: token.data,
    appVersion: mobileConfig.version,
  });
  if (response.device?.id) await mobileStore.putSetting(deviceKey, response.device.id);
  return response.device ?? null;
};

export const revokeDeviceDelivery = async (client: WorkbenchClient) => {
  const deviceId = await mobileStore.getSetting(deviceKey);
  if (!deviceId) return;
  await client.devices.revoke(deviceId).catch(() => undefined);
  await mobileStore.putSetting(deviceKey, null);
};

export const isDeviceDeliveryRegistered = async (client: WorkbenchClient) => {
  const deviceId = await mobileStore.getSetting(deviceKey);
  if (!deviceId) return false;
  const response = await client.devices.list();
  const active = response.devices?.some(
    (device) => device.id === deviceId && device.status === "active",
  );
  if (!active) await mobileStore.putSetting(deviceKey, null);
  return Boolean(active);
};

const openCanonicalRoute = (data: unknown) => {
  if (!data || typeof data !== "object") return;
  const route = "route" in data && typeof data.route === "string" ? data.route : "";
  const recordId = "recordId" in data && typeof data.recordId === "string" ? data.recordId : "";
  if (route === "approvals") router.push("/approvals");
  else if (route === "actions") router.push("/actions");
  else if (route === "history" && recordId)
    router.push({ pathname: "/run/[id]", params: { id: recordId } });
  else if (route === "history") router.push("/(tabs)/history");
};

export function MobileDeviceProvider({ children }: PropsWithChildren) {
  const { state } = useMobileAuth();
  useEffect(() => {
    if (state !== "signed-in") return;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openCanonicalRoute(response.notification.request.content.data);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      openCanonicalRoute(response.notification.request.content.data);
    });
    return () => subscription.remove();
  }, [state]);
  return children;
}
