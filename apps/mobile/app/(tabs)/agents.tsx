import { router } from "expo-router";
import { Text, View } from "react-native";
import { useActivateAgent, useWorkbenchAgents } from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { colors } from "../../src/theme";
import { useWorkbench } from "../../src/workbench-provider";

export default function AgentsScreen() {
  const { notifyChatSelectionChanged } = useWorkbench();
  const agents = useWorkbenchAgents();
  const activation = useActivateAgent();
  const activate = async (agentId: string) => {
    await activation.mutateAsync({ agentId });
    notifyChatSelectionChanged();
  };
  return (
    <Screen
      title="Agents"
      subtitle="Activate a trusted package or run one of its declared workflows."
      refreshing={agents.isFetching}
      onRefresh={() => void agents.refetch()}
    >
      <ErrorNotice message={agents.error instanceof Error ? agents.error.message : null} />
      {(agents.data?.agents ?? []).map((agent) => (
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
                disabled={activation.isPending}
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
            {agent.isActive && (agent.behavior.pack?.managedState?.length ?? 0) > 0 ? (
              <ActionButton label="Managed state" onPress={() => router.push("/managed-state")} />
            ) : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
