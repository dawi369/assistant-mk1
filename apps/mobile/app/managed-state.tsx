import { useWorkbenchAgents, useWorkbenchManagedState } from "@assistant-mk1/workbench-react";
import { Text } from "react-native";

import { Card, ErrorNotice, Screen } from "../src/components/screen";
import { ManagedStateCard } from "../src/components/generic-renderers";
import { colors } from "../src/theme";

export default function ManagedStateScreen() {
  const agents = useWorkbenchAgents();
  const managedState = useWorkbenchManagedState();
  const activeAgent = agents.data?.agents?.find((agent) => agent.isActive);
  const namespaces = new Set(
    (activeAgent?.behavior.pack?.managedState ?? []).map((descriptor) => descriptor.namespace),
  );
  const states = (managedState.data?.states ?? []).filter(
    (state) =>
      state.agentId === activeAgent?.id && (!namespaces.size || namespaces.has(state.namespace)),
  );
  const error = managedState.error ?? agents.error;
  return (
    <Screen
      subtitle="Current versioned state published by the active agent."
      refreshing={managedState.isFetching || agents.isFetching}
      onRefresh={() => void Promise.all([managedState.refetch(), agents.refetch()])}
    >
      <ErrorNotice message={error instanceof Error ? error.message : null} />
      {states.map((state) => (
        <ManagedStateCard key={state.id} state={state} />
      ))}
      {!managedState.isLoading && !states.length ? (
        <Card>
          <Text style={{ color: colors.muted }}>
            This agent has not published managed state yet.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
