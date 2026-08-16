import { ActivityIndicator, Text, View } from "react-native";

import { colors } from "../../src/theme";

export default function MobileAuthCallbackScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        backgroundColor: colors.canvas,
      }}
    >
      <ActivityIndicator color={colors.accent} />
      <Text style={{ color: colors.muted, fontSize: 16 }}>Completing sign in…</Text>
    </View>
  );
}
