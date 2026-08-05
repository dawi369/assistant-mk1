import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { useMobileAuth } from "../../src/auth/auth-provider";
import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { useMobileResource } from "../../src/hooks/use-mobile-resource";
import { mobileStore } from "../../src/storage/mobile-store";
import { colors } from "../../src/theme";
import { useWorkbench } from "../../src/workbench-provider";

export default function SettingsScreen() {
  const { client } = useWorkbench();
  const { signOut } = useMobileAuth();
  const load = useCallback(() => client.workspaces.list(), [client]);
  const { data, error, refreshing, refresh } = useMobileResource("workspaces", load);
  const [busy, setBusy] = useState<string | null>(null);
  const activate = async (id: string) => {
    setBusy(id);
    try {
      await client.workspaces.activate(id);
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  const leave = async () => {
    await mobileStore.clearLocalAuthority();
    await signOut();
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
      <View style={{ marginHorizontal: 16, marginTop: 12 }}>
        <ActionButton label="Sign out" destructive onPress={() => void leave()} />
      </View>
    </Screen>
  );
}
