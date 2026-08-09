import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";

import { useMobileAuth } from "../../src/auth/auth-provider";
import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { useMobileResource } from "../../src/hooks/use-mobile-resource";
import { mobileStore } from "../../src/storage/mobile-store";
import { colors } from "../../src/theme";
import { useWorkbench } from "../../src/workbench-provider";
import {
  isDeviceDeliveryRegistered,
  registerDeviceDelivery,
  revokeDeviceDelivery,
} from "../../src/notifications/device-provider";

export default function SettingsScreen() {
  const { client, notifyChatSelectionChanged } = useWorkbench();
  const { signOut } = useMobileAuth();
  const load = useCallback(() => client.workspaces.list(), [client]);
  const { data, error, refreshing, refresh } = useMobileResource(load);
  const loadNotifications = useCallback(() => client.notificationPreferences.get(), [client]);
  const notifications = useMobileResource(loadNotifications);
  const [busy, setBusy] = useState<string | null>(null);
  const [deviceRegistered, setDeviceRegistered] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  useEffect(() => {
    void isDeviceDeliveryRegistered(client)
      .then(setDeviceRegistered)
      .catch(() => undefined);
  }, [client]);
  const activate = async (id: string) => {
    setBusy(id);
    try {
      await revokeDeviceDelivery(client);
      await client.workspaces.activate(id);
      await mobileStore.clearLocalAuthority();
      setDeviceRegistered(false);
      notifyChatSelectionChanged();
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  const disableNotifications = async () => {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      await revokeDeviceDelivery(client);
      setDeviceRegistered(false);
    } catch (nextError) {
      setNotificationError(
        nextError instanceof Error ? nextError.message : "Could not disable notifications.",
      );
    } finally {
      setNotificationBusy(false);
    }
  };
  const enableNotifications = async () => {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      const device = await registerDeviceDelivery(client);
      if (!device) throw new Error("Notifications were not enabled on this device.");
      setDeviceRegistered(true);
    } catch (nextError) {
      setNotificationError(
        nextError instanceof Error ? nextError.message : "Could not enable notifications.",
      );
    } finally {
      setNotificationBusy(false);
    }
  };
  const leave = async () => {
    await revokeDeviceDelivery(client);
    await mobileStore.clearLocalAuthority();
    await signOut();
  };
  const updateNotifications = async (input: {
    approvalRequired: boolean;
    terminalOutcomes: boolean;
  }) => {
    await client.notificationPreferences.update(input);
    await notifications.refresh();
  };
  return (
    <Screen
      title="Settings"
      subtitle="Workspace, connection, approval, and session controls."
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <ErrorNotice message={error} />
      {(data?.workspaces ?? []).map((workspace) => (
        <Card key={workspace.id}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {workspace.name}
          </Text>
          <Meta>{workspace.isActive ? "Current workspace" : workspace.status}</Meta>
          {!workspace.isActive ? (
            <View style={{ marginTop: 10 }}>
              <ActionButton
                label="Switch"
                disabled={busy === workspace.id}
                onPress={() => void activate(workspace.id)}
              />
            </View>
          ) : null}
        </Card>
      ))}
      <Card>
        <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", marginBottom: 12 }}>
          Operator controls
        </Text>
        <View style={{ gap: 10 }}>
          <ActionButton label="Approvals" onPress={() => router.push("/approvals")} />
          <ActionButton label="Connections" onPress={() => router.push("/connections")} />
          <ActionButton label="Action ledger" onPress={() => router.push("/actions")} />
        </View>
      </Card>
      {notifications.data?.enabled && notifications.data.preferences ? (
        <Card>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700", marginBottom: 12 }}>
            Notifications
          </Text>
          {!deviceRegistered ? (
            <View style={{ marginBottom: 14, gap: 8 }}>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>
                Enable notifications when you want approval and completion alerts on this device.
              </Text>
              <ActionButton
                label={notificationBusy ? "Enabling…" : "Enable notifications"}
                disabled={notificationBusy}
                onPress={() => void enableNotifications()}
              />
              <ErrorNotice message={notificationError} />
            </View>
          ) : null}
          <View style={{ gap: 14 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: colors.ink }}>Approval required</Text>
              <Switch
                accessibilityLabel="Approval required notifications"
                value={notifications.data.preferences.approvalRequired}
                disabled={!deviceRegistered}
                onValueChange={(approvalRequired) =>
                  void updateNotifications({
                    approvalRequired,
                    terminalOutcomes: notifications.data!.preferences!.terminalOutcomes,
                  })
                }
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: colors.ink }}>Completed work</Text>
              <Switch
                accessibilityLabel="Terminal outcome notifications"
                value={notifications.data.preferences.terminalOutcomes}
                disabled={!deviceRegistered}
                onValueChange={(terminalOutcomes) =>
                  void updateNotifications({
                    approvalRequired: notifications.data!.preferences!.approvalRequired,
                    terminalOutcomes,
                  })
                }
              />
            </View>
            {deviceRegistered ? (
              <ActionButton
                label={notificationBusy ? "Disabling…" : "Disable on this device"}
                disabled={notificationBusy}
                onPress={() => void disableNotifications()}
              />
            ) : null}
          </View>
        </Card>
      ) : null}
      <View style={{ marginHorizontal: 16, marginTop: 12 }}>
        <ActionButton label="Sign out" destructive onPress={() => void leave()} />
      </View>
    </Screen>
  );
}
