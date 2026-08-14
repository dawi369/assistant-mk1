import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react-native";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

import { useMobileChat } from "../chat/chat-runtime";
import { mobileStore } from "../storage/mobile-store";
import { colors } from "../theme";
import { ChatToolCall, ReasoningBlock } from "./generic-renderers";

const Message = () => (
  <MessagePrimitive.Root style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
    <MessagePrimitive.If user>
      <View
        style={{
          alignSelf: "flex-end",
          maxWidth: "88%",
          borderRadius: 20,
          backgroundColor: colors.accent,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <MessagePrimitive.Content
          renderText={({ part }) => (
            <Text style={{ color: "white", fontSize: 16 }}>{part.text}</Text>
          )}
        />
      </View>
    </MessagePrimitive.If>
    <MessagePrimitive.If assistant>
      <View style={{ maxWidth: "94%", paddingHorizontal: 2, paddingVertical: 10 }}>
        <MessagePrimitive.Content
          renderText={({ part }) => (
            <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>{part.text}</Text>
          )}
          renderReasoning={({ part }) => <ReasoningBlock text={part.text} />}
          renderToolCall={({ part }) => (
            <ChatToolCall toolName={part.toolName} result={part.result} isError={part.isError} />
          )}
        />
      </View>
    </MessagePrimitive.If>
  </MessagePrimitive.Root>
);

const DraftPersistence = () => {
  const { threadId } = useMobileChat();
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const loadedThreadRef = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    loadedThreadRef.current = null;
    void mobileStore.getDraft(threadId).then((draft) => {
      if (!current) return;
      aui.composer.setText(draft);
      loadedThreadRef.current = threadId;
    });
    return () => {
      current = false;
    };
  }, [aui, threadId]);

  useEffect(() => {
    if (loadedThreadRef.current !== threadId) return;
    const timeout = setTimeout(() => void mobileStore.putDraft(threadId, text), 180);
    return () => clearTimeout(timeout);
  }, [text, threadId]);
  return null;
};

export const ChatThread = () => (
  <ThreadPrimitive.Root style={{ flex: 1, backgroundColor: colors.canvas }}>
    <DraftPersistence />
    <ThreadPrimitive.Empty>
      <View style={{ flex: 1, justifyContent: "center", padding: 32 }}>
        <Text style={{ color: colors.ink, fontSize: 28, fontWeight: "700" }}>
          What are we working on?
        </Text>
        <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 8 }}>
          Your first message waits for the workspace to connect, then sends once.
        </Text>
      </View>
    </ThreadPrimitive.Empty>
    <ThreadPrimitive.MessagesFlatList
      components={{ Message }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end", paddingVertical: 12 }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    />
    <ComposerPrimitive.Root
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 10,
        margin: 12,
        padding: 8,
        paddingLeft: 14,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <ComposerPrimitive.Input
        accessibilityLabel="Message"
        multiline
        placeholder="Message your agent"
        placeholderTextColor={colors.muted}
        style={{
          flex: 1,
          minHeight: 40,
          maxHeight: 140,
          color: colors.ink,
          fontSize: 16,
          paddingTop: 9,
        }}
      />
      <ComposerPrimitive.Send
        accessibilityLabel="Send message"
        style={{
          borderRadius: 18,
          backgroundColor: colors.accent,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>Send</Text>
      </ComposerPrimitive.Send>
      <ComposerPrimitive.Cancel
        accessibilityLabel="Stop response"
        style={{
          borderRadius: 18,
          backgroundColor: colors.danger,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: "white", fontWeight: "700" }}>Stop</Text>
      </ComposerPrimitive.Cancel>
    </ComposerPrimitive.Root>
  </ThreadPrimitive.Root>
);
