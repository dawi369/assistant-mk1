import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { MobileChatRuntimeProvider } from "../../src/chat/chat-runtime";
import { ChatThread } from "../../src/components/chat-thread";
import { colors } from "../../src/theme";

export default function ChatScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View
        style={{
          paddingTop: 54,
          paddingHorizontal: 16,
          paddingBottom: 8,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}
        >
          Assistant
        </Text>
        <Link href="/threads" asChild>
          <Pressable accessibilityRole="button" style={{ padding: 8 }}>
            <Text style={{ color: colors.accent, fontWeight: "700" }}>Chats</Text>
          </Pressable>
        </Link>
      </View>
      <MobileChatRuntimeProvider>
        <ChatThread />
      </MobileChatRuntimeProvider>
    </View>
  );
}
