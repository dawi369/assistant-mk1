import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { useMobileResource } from "../src/hooks/use-mobile-resource";
import { colors } from "../src/theme";
import { useWorkbench } from "../src/workbench-provider";

export default function ThreadsScreen() {
  const { client } = useWorkbench();
  const [archived, setArchived] = useState(false);
  const load = useCallback(
    () => client.threads.list(archived ? "archived" : "active"),
    [archived, client],
  );
  const { data, error, refreshing, refresh } = useMobileResource(`threads-${archived}`, load);
  const mutate = async (id: string, status: "active" | "archived" | "deleted") => {
    await client.threads.update(id, { status });
    await refresh();
  };
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
        <ActionButton
          label={archived ? "Active chats" : "Archived chats"}
          onPress={() => setArchived((value) => !value)}
        />
        {!archived ? (
          <ActionButton
            label="New chat"
            onPress={() => void client.threads.create().then(() => refresh())}
          />
        ) : null}
      </View>
      <ErrorNotice message={error} />
      {(data?.threads ?? []).map((thread) => (
        <Card key={thread.threadId}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {thread.title || "New chat"}
          </Text>
          <Meta>
            {thread.agent?.name ?? "Agent"} · {thread.status}
          </Meta>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {archived ? (
              <ActionButton
                label="Restore"
                onPress={() => void mutate(thread.threadId, "active")}
              />
            ) : (
              <ActionButton
                label="Archive"
                onPress={() => void mutate(thread.threadId, "archived")}
              />
            )}
            <ActionButton
              label="Delete"
              destructive
              onPress={() => void mutate(thread.threadId, "deleted")}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
