import { Text, View } from "react-native";
import { useProposalAction, useWorkbenchActions } from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { colors } from "../src/theme";

export default function ActionsScreen() {
  const actions = useWorkbenchActions({ limit: 100 });
  const execute = useProposalAction("execute");
  const reconcile = useProposalAction("reconcile");
  return (
    <Screen refreshing={actions.isFetching} onRefresh={() => void actions.refetch()}>
      <ErrorNotice message={actions.error instanceof Error ? actions.error.message : null} />
      {(actions.data?.proposals ?? []).map((proposal) => (
        <Card key={proposal.id}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {proposal.actionType}
          </Text>
          <Text style={{ color: colors.muted, marginTop: 5 }}>{proposal.summary}</Text>
          <Meta>
            {proposal.status} · {proposal.toolId}
          </Meta>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {proposal.status === "approved" ? (
              <ActionButton
                label="Execute"
                disabled={execute.isPending}
                onPress={() => void execute.mutateAsync(proposal.id)}
              />
            ) : null}
            {proposal.status === "outcome_unknown" ? (
              <ActionButton
                label="Reconcile"
                disabled={reconcile.isPending}
                onPress={() => void reconcile.mutateAsync(proposal.id)}
              />
            ) : null}
          </View>
          {proposal.ledger.map((entry) => (
            <Meta key={entry.sequence}>
              {entry.status} · {entry.summary}
            </Meta>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
