import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";

import { colors } from "../../src/theme";

const Icon = ({ label, color }: { label: string; color: ColorValue }) => (
  <Text style={{ color, fontSize: 12, fontWeight: "800" }}>{label}</Text>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Chat", tabBarIcon: ({ color }) => <Icon label="CH" color={color} /> }}
      />
      <Tabs.Screen
        name="agents"
        options={{ title: "Agents", tabBarIcon: ({ color }) => <Icon label="AG" color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "History", tabBarIcon: ({ color }) => <Icon label="HI" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Icon label="SE" color={color} />,
        }}
      />
    </Tabs>
  );
}
