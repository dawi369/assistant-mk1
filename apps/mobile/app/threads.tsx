import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  useActivateThread,
  useCreateThread,
  useUpdateThread,
  useWorkbenchThreads,
} from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { colors } from "../src/theme";
import { useWorkbench } from "../src/workbench-provider";

export default function ThreadsScreen() {
  const { notifyChatSelectionChanged } = useWorkbench();
  const [archived, setArchived] = useState(false);
  const threads = useWorkbenchThreads(archived ? "archived" : "active");
  const update = useUpdateThread();
  const activate = useActivateThread();
  const createThread = useCreateThread();
  const mutate = async (id: string, status: "active" | "archived" | "deleted") => {
    await update.mutateAsync({ threadId: id, status });
  };
  const open = async (threadId: string) => {
    await activate.mutateAsync(threadId);
    notifyChatSelectionChanged();
    router.replace("/(tabs)");
  };
  const create = async () => {
    await createThread.mutateAsync();
    notifyChatSelectionChanged();
    router.replace("/(tabs)");
  };
  return (
    <Screen refreshing={threads.isFetching} onRefresh={() => void threads.refetch()}>
      <View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
        <ActionButton
          label={archived ? "Active chats" : "Archived chats"}
          onPress={() => setArchived((value) => !value)}
        />
        {!archived ? <ActionButton label="New chat" onPress={() => void create()} /> : null}
      </View>
      <ErrorNotice message={threads.error instanceof Error ? threads.error.message : null} />
      {(threads.data?.threads ?? []).map((thread) => (
        <Card key={thread.threadId}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {thread.title || "New chat"}
          </Text>
          <Meta>
            {thread.agent?.name ?? "Agent"} · {thread.status}
          </Meta>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {!archived ? (
              <ActionButton label="Open" onPress={() => void open(thread.threadId)} />
            ) : null}
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
