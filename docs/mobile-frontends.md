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
are stored in SecureStore. Non-sensitive display snapshots, drafts, the device
installation ID, and at most one pending chat turn are stored in SQLite.

`@assistant-mk1/workbench-client` is framework-neutral. It owns HTTP construction,
bearer injection, runtime validation, normalized errors, aborts, pagination,
idempotency, session replay, and the public chat transport contract.
`@assistant-mk1/workbench-react` adds React Query behavior for the web product.
Both are unpublished workspace packages and are verified as packed, zero-context
Vite and Expo dependencies.

## Configure WorkOS mobile identity

Create a separate public application in the same WorkOS environment as the web
application:

1. Enable Authorization Code with PKCE; do not create or embed a client secret.
2. Register `assistantmk1://auth/callback` for internal builds.
3. Register the production universal/app-link callbacks for the deployed origin.
4. Choose the mobile session lifetime independently from the web application.
5. Set `EXPO_PUBLIC_WORKOS_CLIENT_ID` to the public application ID.
6. Add that ID to server-only `WORKBENCH_WORKOS_ALLOWED_CLIENT_IDS` and configure
   `WORKBENCH_WORKOS_ISSUER` plus `WORKBENCH_WORKOS_JWKS_URL` on Vercel.
7. Enable `WORKBENCH_MOBILE_CLIENTS_ENABLED` only after hosted bearer acceptance.

When an Authorization header is present, bearer identity is authoritative. An
invalid, expired, wrong-environment, or unapproved token returns `401`; it never
falls back to the web cookie. Without a bearer token, existing web and local
development identity behavior is unchanged.

## Run the reference app

```bash
pnpm --filter @assistant-mk1/mobile start
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
actions. Packs remain fully operable through generic workflow schemas, managed
state, and JSON/Markdown/table/artifact descriptors; web renderer contributions
are not loaded on native.

## Resume and offline contract

- Sending before bootstrap waits for auth/session readiness and retains one stable
  `clientTurnId`; a crash or retry cannot start a second model run.
- Session events resume from a durable cursor. The Session Durable Object retains
  256 events or 15 minutes and sends `replayReset: true` with a canonical snapshot
  when a cursor is too old.
- Backgrounding closes live transports without cancelling server work.
  Foregrounding refreshes auth, reconnects chat, resumes events, and revalidates
  visible resources.
- Drafts and one pending chat turn survive restarts. Workflows, approvals,
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
