import { Text, View } from "react-native";

import { ActionButton } from "../src/components/screen";
import { useMobileAuth } from "../src/auth/auth-provider";
import { colors } from "../src/theme";

export default function SignInScreen() {
  const { configured, signIn } = useMobileAuth();
  return (
    <View
      style={{ flex: 1, justifyContent: "center", padding: 28, backgroundColor: colors.canvas }}
    >
      <View
        style={{
          width: 54,
          height: 54,
          borderRadius: 16,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "white", fontSize: 18, fontWeight: "800" }}>A/1</Text>
      </View>
      <Text style={{ color: colors.ink, fontSize: 36, fontWeight: "700", marginTop: 26 }}>
        Assistant
      </Text>
      <Text
        style={{
          color: colors.muted,
          fontSize: 17,
          lineHeight: 24,
          marginTop: 8,
          marginBottom: 28,
        }}
      >
        Sign in to open your agents, chats, and workbench history.
      </Text>
      <ActionButton
        label={configured ? "Sign in" : "Mobile sign-in is not configured"}
        disabled={!configured}
        onPress={() => void signIn()}
      />
    </View>
  );
}
