import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MobileAuthProvider, useMobileAuth } from "../src/auth/auth-provider";
import { colors } from "../src/theme";
import { MobileWorkbenchProvider } from "../src/workbench-provider";
import { MobileDeviceProvider } from "../src/notifications/device-provider";

const Navigation = () => {
  const { state } = useMobileAuth();
  if (state === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.canvas,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Protected guard={state === "signed-out"}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={state === "signed-in"}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="threads" options={{ title: "Chats" }} />
        <Stack.Screen name="run/[id]" options={{ title: "Run" }} />
        <Stack.Screen
          name="workflow/[type]"
          options={{ title: "Workflow", presentation: "modal" }}
        />
        <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
        <Stack.Screen name="connections" options={{ title: "Connections" }} />
        <Stack.Screen name="actions" options={{ title: "Actions" }} />
        <Stack.Screen name="managed-state" options={{ title: "Managed state" }} />
      </Stack.Protected>
    </Stack>
  );
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MobileAuthProvider>
          <MobileWorkbenchProvider>
            <MobileDeviceProvider>
              <StatusBar style="auto" />
              <Navigation />
            </MobileDeviceProvider>
          </MobileWorkbenchProvider>
        </MobileAuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
