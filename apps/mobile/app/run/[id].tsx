import { useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { useMobileResource } from "../../src/hooks/use-mobile-resource";
import { colors } from "../../src/theme";
import { useWorkbench } from "../../src/workbench-provider";

export default function RunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useWorkbench();
  const load = useCallback(() => client.history.getRun(id), [client, id]);
  const { data, error, refreshing, refresh } = useMobileResource(`run-${id}`, load);
  const snapshot = data?.snapshot;
  const run = snapshot?.run;
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <ErrorNotice message={error} />
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
              onPress={() => void client.history.cancel(run.id!).then(() => refresh())}
            />
          ) : null}
          {run?.id ? (
            <ActionButton
              label="Retry"
              onPress={() => void client.history.retry(run.id!).then(() => refresh())}
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
