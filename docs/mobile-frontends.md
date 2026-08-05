# Mobile Frontends

Assistant-mk1 should make a native client comparable in effort to a web client:
authenticate, construct one typed workbench client, bind a chat transport, and
render platform-native surfaces. It should not require duplicating tenancy,
policy, workflow, connection, action, or lifecycle logic.

Document status: active implementation contract. The shared headless client and
React Query packages are implemented and dogfooded by the web application;
mobile identity, resumable transport, the Expo reference app, and push evidence
remain required before native is a supported release surface.

## Current Readiness

| Boundary            | Current state                                                                         | Mobile consequence                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Control-plane data  | Tenant-scoped JSON APIs and redacted contracts                                        | Reusable once exposed through a supported client transport                                   |
| Identity            | WorkOS AuthKit Next.js cookie session                                                 | Web-only; native bearer validation and refresh are absent                                    |
| Vercel facade       | Server derives identity and signs Cloudflare requests                                 | Correct trust boundary; native must call it rather than hold its signing secret              |
| Product API client  | Headless typed client plus React Query adapter; mobile-facing web surfaces dogfood it | Reusable request/auth/error contract is available; Expo installation evidence is still gated |
| Live product events | Browser `EventSource` with reconnect behavior                                         | Needs a fetch-stream or native event adapter with cursor-based resume and AppState handling  |
| Chat transport      | `agents/react`, PartySocket, and `@cloudflare/ai-chat/react` in `app/assistant.tsx`   | Native compatibility is unproven and the wire behavior is not a workbench-owned contract     |
| Chat UI             | DOM assistant-ui primitives and Tailwind                                              | Must be rendered with `@assistant-ui/react-native`; runtime concepts can remain shared       |
| Pack UI             | Trusted React web renderers plus generic web fallbacks                                | Native uses generic schema/artifact views until a pack declares a native renderer            |
| Responsive web      | Desktop and 375px browser acceptance                                                  | Useful mobile web baseline, not evidence for iOS/Android lifecycle behavior                  |

The backend ownership split is already the right one. The missing layer is a
platform-neutral client contract between product UIs and the Vercel/Cloudflare
boundaries. Reusing the current React components in React Native is explicitly
not the goal.

## Target Client Boundary

Add an initially unpublished `@assistant-mk1/workbench-client` package with no
React, Next.js, Node.js, Cloudflare, or DOM dependency. Its public surface is:

```ts
type AccessTokenProvider = () => Promise<string | null>;

type WorkbenchClientOptions = {
  baseUrl: string;
  getAccessToken?: AccessTokenProvider;
  fetch?: typeof globalThis.fetch;
};

type WorkbenchRealtimeAdapter = {
  subscribeSession(input: SessionSubscriptionInput): SessionSubscription;
  connectChat(input: ChatConnectionDescriptor): WorkbenchChatTransport;
};
```

The client owns request construction, schema parsing, normalized errors,
abort/timeouts, pagination, idempotency headers, and typed resource methods.
It does not own authentication state, caching policy, React state, UI, retries
of mutations, or any service secret.

Adapters remain platform-specific:

- Web: same-origin base URL, HttpOnly WorkOS cookie, browser fetch/EventSource,
  and the existing assistant-ui web renderer.
- Native: absolute Vercel origin, WorkOS public-client authorization-code flow
  with PKCE, bearer access-token provider, native fetch/WebSocket/AppState, and
  `@assistant-ui/react-native` primitives.
- Tests: deterministic in-memory HTTP and realtime adapters.

Vercel validates either its existing server session or a WorkOS bearer access
token, derives the same trusted identity, and signs the same private Cloudflare
request. The facade signing secret never enters web or native application code.
Cloudflare continues to make every tenant and authorization decision.

The bearer boundary is implemented behind `WORKBENCH_MOBILE_CLIENTS_ENABLED`.
When enabled, deployments must configure the environment issuer, JWKS URL, and
comma-separated mobile application IDs. A present `Authorization` header is
authoritative: invalid or unapproved bearer tokens return `401` and never fall
back to the web cookie. The production flag remains off until a separate WorkOS
public application and hosted mobile acceptance are complete.

## Realtime And Offline Rules

- A client may cache display snapshots, never authorization or mutation state.
- Resource reads use stale-while-revalidate with request deduplication. A
  background refresh does not replace usable content with a loading screen.
- Mutations update optimistically only when rollback is deterministic. Their
  stable idempotency key survives app suspension and network retries.
- Session events carry a cursor. Reconnect resumes from the cursor or performs
  one scoped snapshot refresh when the replay window is unavailable.
- Native foregrounding checks token freshness, reconnects live channels, and
  revalidates visible resources. Backgrounding must not imply cancellation.
- Push notifications are wake-up hints only; opening the app re-reads canonical
  state before showing an approval or terminal outcome.

## Chat Contract

Do not make PartySocket or a Cloudflare package's internal wire messages the
public mobile API. Define a workbench-owned chat transport contract covering:

- thread and agent identity;
- append, cancel, reconnect, and resume;
- ordered message/tool/status parts;
- bounded attachment references;
- terminal and recoverable errors;
- token expiry and connection replacement after agent handoff.

The web adapter may continue using Cloudflare's React hooks internally. The
native adapter can use a native WebSocket or HTTP stream, but both must pass the
same transport conformance fixtures. assistant-ui runtime state and tool
descriptors are shared; DOM and native renderers remain separate.

## Pack Rendering

Runtime Module v1 web renderers remain trusted web-only contributions. A pack
must work on native without one through generic JSON, Markdown, table, form,
artifact, approval, connection, and action-ledger views. A future additive
native renderer declaration may improve presentation but cannot be required to
operate a pack.

## Implementation Sequence

1. Extract all browser-facing workbench requests into
   `@assistant-mk1/workbench-client`; migrate the web app without changing API
   behavior and add package/contract hashes beside the Agent SDK checks.
2. Add WorkOS bearer validation to the Vercel facade, a separate mobile WorkOS
   application, PKCE/deep-link documentation, and cross-client tenant-isolation
   tests.
3. Define the workbench chat transport and session-event cursor contracts;
   retain web adapters and add deterministic reconnect/background tests.
4. Add a minimal Expo acceptance app outside production navigation. Prove sign
   in, thread list, send/stream/cancel/resume, archived history, workflow run,
   approval, artifact, connection status, and sign out on iOS and Android.
5. Promote native support only after the same lifecycle, authorization,
   mutation, accessibility, and failure-state guarantees pass for both clients.

## Release Gate

“Native mobile supported” is true only when a clean external app can install
the client package, authenticate without a service secret, and pass the shared
client conformance suite plus iOS and Android device journeys. Responsive web
screens and TypeScript compatibility alone are not sufficient evidence.
