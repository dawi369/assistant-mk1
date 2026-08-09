import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { useMobileResource } from "../../src/hooks/use-mobile-resource";
import { colors } from "../../src/theme";
import { useWorkbench } from "../../src/workbench-provider";

export default function AgentsScreen() {
  const { client } = useWorkbench();
  const load = useCallback(() => client.agents.list(), [client]);
  const { data, error, refreshing, refresh } = useMobileResource(load);
  const [busy, setBusy] = useState<string | null>(null);
  const activate = async (agentId: string) => {
    setBusy(agentId);
    try {
      await client.agents.activate(agentId);
      await refresh();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen
      title="Agents"
      subtitle="Activate a trusted package or run one of its declared workflows."
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      <ErrorNotice message={error} />
      {(data?.agents ?? []).map((agent) => (
        <Card key={agent.id}>
          <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "700" }}>{agent.name}</Text>
          <Text style={{ color: colors.muted, marginTop: 5, lineHeight: 20 }}>
            {agent.description}
          </Text>
          <Meta>{agent.isActive ? "Active" : agent.status}</Meta>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {!agent.isActive ? (
              <ActionButton
                label="Activate"
                disabled={busy === agent.id}
                onPress={() => void activate(agent.id)}
              />
            ) : null}
            {(agent.behavior.pack?.workflows ?? [])
              .filter((workflow) => workflow.userInvocable)
              .map((workflow) => (
                <ActionButton
                  key={workflow.type}
                  label={workflow.type}
                  onPress={() =>
                    router.push({ pathname: "/workflow/[type]", params: { type: workflow.type } })
                  }
                />
              ))}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
