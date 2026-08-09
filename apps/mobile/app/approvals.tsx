import { useCallback } from "react";
import { Text, View } from "react-native";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { useMobileResource } from "../src/hooks/use-mobile-resource";
import { colors } from "../src/theme";
import { useWorkbench } from "../src/workbench-provider";

export default function ApprovalsScreen() {
  const { client } = useWorkbench();
  const load = useCallback(() => client.approvals.list(), [client]);
  const { data, error, refreshing, refresh } = useMobileResource(load);
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <ErrorNotice message={error} />
      {(data?.approvals ?? []).map((approval) => (
        <Card key={approval.id}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {approval.toolId ?? "Approval"}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 5 }}>{approval.reason}</Text>
          <Meta>{approval.status}</Meta>
          {approval.status === "requested" && approval.id ? (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <ActionButton
                label="Approve"
                onPress={() => void client.approvals.approve(approval.id!).then(() => refresh())}
              />
              <ActionButton
                label="Deny"
                destructive
                onPress={() => void client.approvals.deny(approval.id!).then(() => refresh())}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
