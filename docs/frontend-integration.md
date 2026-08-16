# Frontend Integration

Assistant-mk1 supports three frontend shapes through one public client
boundary: the bundled Next.js app, an independent browser app, and a native
Expo app. All use the same product contracts; none receives Cloudflare, Fly,
Vault, model-provider, callback, or facade-signing secrets.

```text
React web or Expo UI
  -> @assistant-mk1/workbench-react
  -> @assistant-mk1/workbench-client
  -> Vercel bearer/cookie facade
  -> signed Cloudflare control plane
  -> Fly only for registered heavy execution
```

The packages are private and initially unpublished. They are a stable fork
boundary, not a promise of public npm distribution.

## Package the client boundary

```bash
pnpm workbench client pack
```

The command builds both packages and writes portable `.tgz` archives plus
`manifest.json` to `output/workbench-client-distribution/`. The manifest binds
archive SHA-256 checksums, the runtime-schema contract hash, application
version, and source commit. Packaging fails on source files, unresolved
workspace dependencies, local state, or repository-relative imports.

For CI-grade installation and runtime proof, use:

```bash
pnpm workbench-client:contract --check
pnpm workbench-client:verify
pnpm conformance:client
```

These gates pack zero-context Vite and Expo consumers without workspace links,
execute representative valid and invalid responses, and verify the tracked
public contract.

## Create the headless client

```ts
import { WorkbenchClientError, createWorkbenchClient } from "@assistant-mk1/workbench-client";

export const client = createWorkbenchClient({
  baseUrl: "https://assistant.example.com",
  getAccessToken: ({ minValidityMs } = {}) => identity.getAccessToken({ minValidityMs }),
  client: { platform: "web", version: "1.0.0" },
});

try {
  const result = await client.history.listRuns({ signal });
  render(result.runs);
} catch (error) {
  if (error instanceof WorkbenchClientError) {
    report({ code: error.code, requestId: error.requestId });
  }
}
```

`baseUrl` is always the Vercel workbench origin, never the private Worker or
Fly origin. The client attaches platform/version metadata, stable idempotency
headers where required, request timeouts, caller abort signals, and bearer or
cookie credentials. It runtime-validates every successful public response:
required known fields fail closed, unknown fields remain compatible, and
invalid response bodies never enter errors or telemetry.

The client exposes these resource groups:

- session, active/archived threads, account context, and workspaces;
- agents, pack activation, workflow discovery, and workflow execution;
- History runs/artifacts, cancellation, linked retry, and approvals;
- connections, credential authorization, health, refresh, and revocation;
- action proposals, execution/reconciliation state, and managed state;
- client devices and notification preferences.

Admin, diagnostics, retention, exports, workspace quarantine/deletion, and
kill-switch administration remain application-owned web surfaces.

## Authentication recipes

### Bundled or same-origin Next.js

Use `baseUrl: ""` and omit `getAccessToken`. Requests include the WorkOS cookie
and the Vercel server derives tenant scope before signing the Cloudflare
request.

```ts
createWorkbenchClient({
  baseUrl: "",
  client: { platform: "web", version: appVersion },
});
```

### Independent browser app

Use the canonical Vercel origin and supply a WorkOS public-client access token.
The deployment must explicitly allow the browser origin in its CORS
configuration. An invalid bearer token is authoritative and cannot fall back
to a cookie.

### Expo / native

Use the canonical Vercel origin and a PKCE-authenticated WorkOS mobile token
from the application's secure token store. Native requests do not depend on
browser CORS, but the WorkOS `client_id` must be in the server allowlist. Never
put a WorkOS API key or service secret in an `EXPO_PUBLIC_*` variable.

## React resource layer

`@assistant-mk1/workbench-react` is the shared React Query layer for React DOM
and React Native:

```tsx
const queryClient = createWorkbenchQueryClient();

<WorkbenchClientProvider client={client} queryClient={queryClient}>
  <Application />
</WorkbenchClientProvider>;
```

Use its query and mutation hooks instead of calling the headless client from
components. The package owns tenant-qualified keys, request cancellation,
workspace cache fencing, mutation invalidation, and a pure session-event
invalidation mapper. Workspace switches clear tenant caches before loading the
new workspace; authority-changing operations are never optimistically applied.

The application remains responsible for visual components, routing, auth token
storage, and chat transport lifecycle. The bundled agent-connection provider
publishes its canonical snapshot through `usePublishWorkbenchSession` so chat
and resource views share state without duplicating connection ownership.

## Chat and realtime

The headless package exposes `WorkbenchChatTransport` and
`WorkbenchRealtimeAdapter`; UI code never imports PartySocket or Cloudflare
wire messages. `createWorkbenchChatController` provides one pending turn,
stable `clientTurnId` delivery, reconnect/pause/resume behavior, cancellation,
and handoff/token-refresh replacement semantics.

The initial session event adapter resumes with an event cursor. Applications
should persist only the last cursor and non-sensitive display snapshots. On a
replay reset, replace local state with the canonical session snapshot. Workflow
runs, approvals, connections, and actions are online-only and must not be
silently queued.

## Agent Pack UI portability

Agent Packs remain usable in every frontend through JSON Schemas, workflow
descriptors, managed-state descriptors, and generic JSON/Markdown/table/form
artifacts. Trusted React renderers in Runtime Module web exports are web-only;
native clients must fall back to generic rendering. A pack therefore needs no
mobile source edit to remain operable.

Fork-specific UI may wrap these primitives, but should not bypass the Vercel
identity facade, duplicate tenancy decisions, execute provider tools in the
client, or depend on internal `@/lib` aliases.
