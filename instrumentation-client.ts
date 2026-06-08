import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    replaysOnErrorSampleRate: 1.0,
    initialScope: {
      tags: {
        service: "assistant-mk1",
        "runtime.surface": "vercel-next",
      },
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
