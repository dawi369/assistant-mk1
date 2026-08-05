import { Platform } from "react-native";

const value = (name: string, fallback = "") => process.env[name]?.trim() || fallback;

export const mobileConfig = {
  workbenchOrigin: value("EXPO_PUBLIC_WORKBENCH_ORIGIN", "https://assistant-mk1.vercel.app"),
  workosClientId: value("EXPO_PUBLIC_WORKOS_CLIENT_ID"),
  workosIssuer: value("EXPO_PUBLIC_WORKOS_ISSUER", "https://api.workos.com"),
  easProjectId: value("EXPO_PUBLIC_EAS_PROJECT_ID"),
  platform: Platform.OS === "ios" ? ("ios" as const) : ("android" as const),
  version: "0.1.0",
};

export const mobileAuthConfigured = Boolean(mobileConfig.workosClientId);
