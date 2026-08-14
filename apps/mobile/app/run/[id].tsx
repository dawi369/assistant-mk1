import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useRunAction, useWorkbenchAgents, useWorkbenchRun } from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { ArtifactRenderer, ToolCallCard } from "../../src/components/generic-renderers";
import { colors } from "../../src/theme";

export default function RunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useWorkbenchRun(id);
  const agents = useWorkbenchAgents();
  const cancel = useRunAction("cancel");
  const retry = useRunAction("retry");
  const snapshot = detail.data?.snapshot;
  const run = snapshot?.run;
  const runtimeAgent = agents.data?.agents?.find((agent) => agent.id === run?.agentId);
  const renderers = runtimeAgent?.behavior.pack?.artifactRenderers ?? [];
  return (
    <Screen refreshing={detail.isFetching} onRefresh={() => void detail.refetch()}>
      <ErrorNotice message={detail.error instanceof Error ? detail.error.message : null} />
      <Card>
        <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "700" }}>
          {run?.status ?? "Run"}
        </Text>
        <Meta>{snapshot?.intent?.type ?? "Execution"}</Meta>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          {run?.id ? (
            <ActionButton
              label="Cancel"
              destructive
              disabled={cancel.isPending}
              onPress={() => void cancel.mutateAsync(run.id!)}
            />
          ) : null}
          {run?.id ? (
            <ActionButton
              label="Retry"
              disabled={retry.isPending}
              onPress={() => void retry.mutateAsync(run.id!)}
            />
          ) : null}
        </View>
      </Card>
      {(snapshot?.artifacts ?? []).map((artifact) => (
        <ArtifactRenderer
          key={artifact.id}
          artifact={artifact}
          descriptor={renderers.find((renderer) => renderer.artifactKind === artifact.kind)}
        />
      ))}
      {(snapshot?.toolCalls ?? []).map((toolCall) => (
        <ToolCallCard key={toolCall.id} toolCall={toolCall} />
      ))}
    </Screen>
  );
}
