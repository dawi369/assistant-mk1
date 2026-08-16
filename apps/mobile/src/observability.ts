import { scrubSentryBreadcrumb, scrubSentryEvent } from "@assistant-mk1/observability";
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

import type { MobileAuthFailure, MobileAuthStage } from "./auth/auth-flow";

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

export function captureMobileAuthFailure(failure: MobileAuthFailure) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    scope.setTag("auth.stage", failure.stage);
    scope.setTag("error.code", failure.code);
    scope.setLevel("error");
    Sentry.captureException(new Error(`Mobile authentication failed: ${failure.code}`));
  });
}

export function recordMobileAuthStage(stage: MobileAuthStage) {
  if (!initialized) return;
  Sentry.addBreadcrumb({ category: "mobile.auth", message: stage, level: "info" });
}
