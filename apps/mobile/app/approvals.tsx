import { Text, View } from "react-native";
import { useApprovalAction, useWorkbenchApprovals } from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { colors } from "../src/theme";

export default function ApprovalsScreen() {
  const approvals = useWorkbenchApprovals();
  const approve = useApprovalAction("approve");
  const deny = useApprovalAction("deny");
  return (
    <Screen refreshing={approvals.isFetching} onRefresh={() => void approvals.refetch()}>
      <ErrorNotice message={approvals.error instanceof Error ? approvals.error.message : null} />
      {(approvals.data?.approvals ?? []).map((approval) => (
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
                disabled={approve.isPending}
                onPress={() => void approve.mutateAsync({ approvalId: approval.id! })}
              />
              <ActionButton
                label="Deny"
                destructive
                disabled={deny.isPending}
                onPress={() => void deny.mutateAsync({ approvalId: approval.id! })}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
