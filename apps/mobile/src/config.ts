import Constants from "expo-constants";
import { Platform } from "react-native";

const value = (input: string | undefined, fallback = "") => input?.trim() || fallback;
const configuredScheme = Constants.expoConfig?.scheme;
const authScheme =
  (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) || "assistantmk1";

export const mobileConfig = {
  // Expo replaces only statically referenced EXPO_PUBLIC_* expressions in application bundles.
  // Dynamic indexed environment lookups work in Node checks but compile empty on-device.
  workbenchOrigin: value(
    process.env.EXPO_PUBLIC_WORKBENCH_ORIGIN,
    "https://assistant-mk1.vercel.app",
  ),
  workosClientId: value(process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID),
  workosIssuer: value(process.env.EXPO_PUBLIC_WORKOS_ISSUER),
  authScheme,
  authCallbackPath: "auth/callback",
  easProjectId:
    value(process.env.EXPO_PUBLIC_EAS_PROJECT_ID) ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    "",
  platform: Platform.OS === "ios" ? ("ios" as const) : ("android" as const),
  version: "0.1.0",
};

export const mobileAuthConfigured = Boolean(
  mobileConfig.workosClientId && mobileConfig.workosIssuer,
);
