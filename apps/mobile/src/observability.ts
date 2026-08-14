import { scrubSentryBreadcrumb, scrubSentryEvent } from "@assistant-mk1/observability";
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
const environment = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT?.trim() || "development";
const release =
  process.env.EXPO_PUBLIC_SENTRY_RELEASE?.trim() ||
  (typeof Constants.expoConfig?.extra?.releaseSha === "string"
    ? Constants.expoConfig.extra.releaseSha
    : `assistant-mk1-mobile@${Constants.expoConfig?.version ?? "development"}`);

let initialized = false;

export function initializeMobileObservability() {
  if (initialized || !dsn) return;
  initialized = true;
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
    tracesSampleRate: environment === "production" ? 0.02 : 0,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    initialScope: {
      tags: {
        service: "assistant-mk1",
        "runtime.surface": "expo-native",
      },
    },
  });
}

export const withMobileObservability = Sentry.wrap;
