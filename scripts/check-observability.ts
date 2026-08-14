import { scrubSentryBreadcrumb, scrubSentryEvent } from "../lib/observability/sentry-scrubber";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sentinel = "observability-check-sensitive-value";
const candidates = [
  scrubSentryEvent({
    user: { id: sentinel, email: `${sentinel}@example.com` },
    request: {
      url: `https://example.com/callback?code=${sentinel}`,
      headers: {
        authorization: `Bearer ${sentinel}.payload.signature`,
        cookie: `session=${sentinel}`,
      },
      data: { credential: sentinel },
    },
    extra: { access_token: sentinel, nested: { client_secret: sentinel } },
    exception: { values: [{ value: `Bearer ${sentinel}.payload.signature` }] },
  }),
  scrubSentryBreadcrumb({
    message: `Bearer ${sentinel}.payload.signature`,
    data: { url: `https://example.com/path?token=${sentinel}`, password: sentinel },
  }),
];

if (JSON.stringify(candidates).includes(sentinel)) {
  throw new Error("Observability scrubber leaked a sensitive sentinel");
}
const mobileSource = [
  readFileSync(resolve(process.cwd(), "apps/mobile/src/observability.ts"), "utf8"),
  readFileSync(resolve(process.cwd(), "apps/mobile/app.json"), "utf8"),
  readFileSync(resolve(process.cwd(), "apps/mobile/metro.config.js"), "utf8"),
  readFileSync(resolve(process.cwd(), "apps/mobile/app.config.js"), "utf8"),
  readFileSync(resolve(process.cwd(), "apps/mobile/scripts/configure-sentry-release.cjs"), "utf8"),
].join("\n");
for (const required of [
  "sendDefaultPii: false",
  "scrubSentryEvent",
  "scrubSentryBreadcrumb",
  "@sentry/react-native/expo",
  "getSentryExpoConfig",
  "EAS_BUILD_GIT_COMMIT_HASH",
  'spawnSync("set-env"',
]) {
  if (!mobileSource.includes(required)) {
    throw new Error(`Mobile observability is missing ${required}.`);
  }
}
if (/EXPO_PUBLIC_(?:SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_PROJECT)/.test(mobileSource)) {
  throw new Error("Mobile observability exposes a build credential through public config.");
}
console.log("Observability privacy boundary verified.");
