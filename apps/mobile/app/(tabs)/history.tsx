import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useWorkbenchRuns } from "@assistant-mk1/workbench-react";

import { Card, ErrorNotice, Meta, Screen } from "../../src/components/screen";
import { colors } from "../../src/theme";

type Filter = "all" | "completed" | "failed";

export default function HistoryScreen() {
  const history = useWorkbenchRuns({ limit: 100 });
  const [filter, setFilter] = useState<Filter>("all");
  const runs = (history.data?.runs ?? []).filter(
    (run) => filter === "all" || run.status === filter,
  );
  return (
    <Screen
      title="History"
      subtitle="Workflow and tool execution, results, and recovery."
      refreshing={history.isFetching}
      onRefresh={() => void history.refetch()}
    >
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 14 }}>
        {(["all", "completed", "failed"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === value }}
            onPress={() => setFilter(value)}
            style={{
              borderRadius: 16,
              paddingHorizontal: 13,
              paddingVertical: 8,
              backgroundColor: filter === value ? colors.accent : colors.surface,
              borderWidth: 1,
              borderColor: filter === value ? colors.accent : colors.line,
            }}
          >
            <Text
              style={{
                color: filter === value ? "white" : colors.ink,
                textTransform: "capitalize",
                fontWeight: "600",
              }}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <ErrorNotice message={history.error instanceof Error ? history.error.message : null} />
      {runs.map((run) => (
        <Card
          key={run.id}
          onPress={() => router.push({ pathname: "/run/[id]", params: { id: run.id } })}
        >
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {run.displayName ?? run.workflowType ?? "Execution"}
          </Text>
          <Meta>
            {run.status ?? "unknown"} · {run.engine ?? "cloudflare"}
          </Meta>
          {run.summary ? (
            <Text style={{ color: colors.muted, marginTop: 7 }} numberOfLines={2}>
              {run.summary}
            </Text>
          ) : null}
        </Card>
      ))}
      {!history.isFetching && runs.length === 0 ? (
        <Text style={{ color: colors.muted, textAlign: "center", padding: 32 }}>
          No matching runs.
        </Text>
      ) : null}
    </Screen>
  );
}
