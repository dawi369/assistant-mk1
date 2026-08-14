import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useRunAction, useWorkbenchRun } from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { colors } from "../../src/theme";

export default function RunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useWorkbenchRun(id);
  const cancel = useRunAction("cancel");
  const retry = useRunAction("retry");
  const snapshot = detail.data?.snapshot;
  const run = snapshot?.run;
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
        <Card key={artifact.id}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {artifact.title ?? "Artifact"}
          </Text>
          <Meta>{artifact.mimeType ?? artifact.uri ?? artifact.id}</Meta>
        </Card>
      ))}
      {(snapshot?.toolCalls ?? []).map((toolCall) => (
        <Card key={toolCall.id}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>
            {toolCall.toolId ?? "Tool call"}
          </Text>
          <Meta>{toolCall.status}</Meta>
          {toolCall.outputSummary ? (
            <Text style={{ color: colors.muted, marginTop: 6 }}>{toolCall.outputSummary}</Text>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
