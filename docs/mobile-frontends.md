# Mobile Frontends

Assistant-mk1 includes a native-first Expo Router reference app for iOS and
Android. It consumes the same portable client, Vercel bearer facade, Cloudflare
control plane, runtime registry, and agent chat protocol as the web product.
Admin and destructive workspace lifecycle operations remain web-only.

## Ownership boundary

```text
Expo app
  -> WorkOS public-client token
  -> Vercel bearer facade
  -> signed Cloudflare control plane
  -> scoped Agent token
  -> Cloudflare Agent chat transport
  -> Fly only for registered heavy execution
```

The app contains no WorkOS API key, Vercel/Cloudflare signing secret, provider
credential, Vault credential, or runner secret. WorkOS access and refresh tokens
are stored in SecureStore. Drafts, the device installation ID, and at most one
pending chat turn are stored in SQLite. Tenant-visible API resources are not
persisted in a generic device cache; focused screens revalidate canonical state.

`@assistant-mk1/workbench-client` is framework-neutral. It owns HTTP construction,
bearer injection, runtime validation, normalized errors, aborts, pagination,
idempotency, session replay, and the public chat transport contract.
`@assistant-mk1/workbench-react` is the optional React Query adapter currently
dogfooded by the web Agents surface. Both packages are unpublished and verified
as packed, zero-context Vite and Expo dependencies.

## Configure WorkOS mobile identity

Create a separate first-party OAuth application under WorkOS Connect in the same
WorkOS environment as the web application:

1. Enable Authorization Code with PKCE; do not create or embed a client secret.
2. Register `assistantmk1://auth/callback` for internal builds.
3. Register the production universal/app-link callbacks for the deployed origin.
4. Set `EXPO_PUBLIC_WORKOS_CLIENT_ID` to the public OAuth application's client ID
   and `EXPO_PUBLIC_WORKOS_ISSUER` to the environment's AuthKit domain.
5. Add that ID to server-only `WORKBENCH_WORKOS_ALLOWED_CLIENT_IDS`; configure
   `WORKBENCH_WORKOS_ISSUER` to the same AuthKit domain and
   `WORKBENCH_WORKOS_JWKS_URL` to `<authkit-domain>/oauth2/jwks` on Vercel.
6. Enable `WORKBENCH_MOBILE_CLIENTS_ENABLED` only for internal acceptance first.

When an Authorization header is present, bearer identity is authoritative. An
invalid, expired, wrong-environment, or unapproved token returns `401`; it never
falls back to the web cookie. Without a bearer token, existing web and local
development identity behavior is unchanged.

## Run the reference app

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm mobile:doctor
pnpm mobile:doctor:ios-device
pnpm mobile:ios:device
# or, for a simulator / Android emulator
pnpm mobile:ios:simulator
pnpm mobile:android
```

The default workflow is local-first. The device, simulator, Android, and cloud
doctor targets validate only the path you intend to use; unavailable optional
paths are warnings. The platform commands generate, compile, install, and open a
development build using the Mac's Xcode or Android SDK. After the native binary
is installed, normal TypeScript/UI changes use the faster Metro-only loop:

```bash
pnpm mobile:start
```

Re-run the platform build after changing a native dependency or Expo config
plugin. For a cloud-independent reproduction of the EAS build pipeline, or the
optional hosted internal-preview path, use:

```bash
pnpm mobile:build:local:ios
pnpm mobile:build:local:android
pnpm mobile:build:eas:ios:development
pnpm mobile:build:eas:android:development
pnpm mobile:build:eas:ios:preview
pnpm mobile:build:eas:android:preview
```

The EAS project link is public build metadata stored in `app.json`; credentials
remain in Expo/EAS and local platform keychains. Daily development does not
consume an EAS cloud build.

Repository verification remains:

```bash
pnpm mobile:check
pnpm conformance:client
pnpm conformance:mobile
```

Public Expo configuration:

- `EXPO_PUBLIC_WORKBENCH_ORIGIN`
- `EXPO_PUBLIC_WORKOS_CLIENT_ID`
- `EXPO_PUBLIC_WORKOS_ISSUER`
- `EXPO_PUBLIC_EAS_PROJECT_ID` for remote push registration outside an EAS build

Core navigation uses native tabs for Chat, Agents, History, and Settings, with
native stack routes for chats, workflows, runs, approvals, connections, and
actions. Current native pack support covers generic workflow discovery/forms,
execution, run status, and artifact metadata. Rich Markdown/table/artifact
content rendering remains a device-acceptance gap; web renderer contributions
are intentionally not loaded on native.

## Resume and offline contract

- Sending before bootstrap waits for auth/session readiness and retains one stable
  `clientTurnId`; a crash or retry cannot start a second model run.
- While the app process is alive, session events reconnect from the last received
  cursor. The Session Durable Object retains 256 events or 15 minutes and sends
  `replayReset: true` with a canonical snapshot when a cursor is too old. A cold
  app start intentionally fetches canonical state rather than trusting persisted
  display data.
- Backgrounding closes live transports without cancelling server work.
  Foregrounding refreshes auth, reconnects chat, resumes events, and revalidates
  visible resources.
- Existing threads can be selected and their Agent transcript hydrates the native
  runtime. Drafts and one pending chat turn survive restarts. Workflows, approvals,
  connections, and actions are online-only and never queued.
- Agent handoff closes the old transport; the old scoped token is rejected.

## Push delivery

Push is an optional wake-up channel behind `WORKBENCH_PUSH_ENABLED`. Expo tokens
are stored in WorkOS Vault under the workspace context. D1 stores device metadata,
preferences, a Vault reference/version, and a redacted 30-day delivery ledger.

A Cloudflare Queue isolates delivery from workflow/chat transactions. LangGraph
runs cannot replace this queue: notifications are out-of-band fan-out that must
survive after a run is terminal and must retry independently of agent execution.
Queue messages contain only a delivery ID. Lock-screen text is generic; payloads
contain only an allowlisted route and opaque record ID. Opening a notification
reauthenticates and reloads canonical state.

Sign-out and workspace quarantine delete the Vault token and revoke the device.
Invalid Expo tokens disable the device. Workspace export includes non-secret
device/preferences/delivery metadata and explicitly excludes token references and
push tokens; purge removes all device state.

The app never prompts for notification permission at sign-in or workspace
switch. An operator must choose **Enable notifications** in Settings before the
device is registered.

## Release evidence

```bash
pnpm test:mobile:e2e:ios
pnpm test:mobile:e2e:android
pnpm acceptance:mobile:hosted
```

The Maestro commands require an installed internal-preview build and available
simulator/device. Hosted acceptance additionally requires a same-commit evidence
JSON covering real WorkOS sign-in, foreground recovery, approval push, terminal
push, and sign-out revocation on one iOS and one Android device. Push stays off
until this evidence is recorded. App Store and Play Store submission are outside
this foundation slice.

`pnpm conformance:mobile` is deterministic foundation evidence: native exports,
type safety, architectural guards, and server protocol unit tests. It does not
claim that simulator, physical-device, notification, or hosted journeys ran;
those are covered only by the explicit E2E and hosted acceptance commands above.
