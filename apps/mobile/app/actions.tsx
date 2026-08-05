import { useCallback } from "react";
import { Text, View } from "react-native";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { useMobileResource } from "../src/hooks/use-mobile-resource";
import { colors } from "../src/theme";
import { useWorkbench } from "../src/workbench-provider";

export default function ActionsScreen() {
  const { client } = useWorkbench();
  const load = useCallback(() => client.actions.list({ limit: 100 }), [client]);
  const { data, error, refreshing, refresh } = useMobileResource("actions", load);
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <ErrorNotice message={error} />
      {(data?.proposals ?? []).map((proposal) => (
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
                onPress={() => void client.actions.execute(proposal.id).then(() => refresh())}
              />
            ) : null}
            {proposal.status === "outcome_unknown" ? (
              <ActionButton
                label="Reconcile"
                onPress={() => void client.actions.reconcile(proposal.id).then(() => refresh())}
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
