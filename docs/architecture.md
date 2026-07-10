# Architecture

Assistant-mk1 is a reusable agent workbench with a conversational control
plane, a heavy execution plane, and a hosted dev/staging split across Vercel,
Cloudflare, and Fly.

The architecture should support personal operation, developer distribution,
and business integrations without forking the core runtime. Customer- or
domain-specific behavior belongs in workspace, agent, policy, tool, context,
and integration configuration, not in hard-coded product assumptions.

The cumulative autonomy levels and guarantees expected from those subsystems
are defined in `capability-model.md`.

Document status: this page is the concise current system map. Use
`docs/infrastructure.md` for request flow and ownership, and
`docs/cloudflare-control-plane.md` for Worker/D1 details.

## System Shape

- Next.js App Router serves the frontend and same-origin API facades.
- WorkOS AuthKit runs at the Vercel web boundary.
- Vercel derives trusted WorkOS/local identity before calling Cloudflare.
- assistant-ui renders the thread, composer, messages, reasoning, tools, and
  attachments.
- Cloudflare resolves authorization, workspace, active agent, active thread,
  normal chat coordination, Admin summaries, runtime events, and control-plane
  state.
- Cloudflare Agents own normal hosted chat through a per-thread
  `WorkbenchThreadChatAgent` Durable Object.
- `WorkbenchSessionAgent` owns hot user/workspace session snapshots, thread
  switching, Agent connection payloads, and live-session events.
- Durable Object SQLite owns hot per-thread messages; D1 mirrors compact
  product/control-plane state for authorization and Admin visibility.
- Fly/LangGraph remain the explicit heavy workflow and server-side tool
  execution plane.
- OpenRouter is configured server-side for Cloudflare Agent chat and the
  Fly/LangGraph runtime.

## Control Plane Model

The core runtime model is:

```txt
trusted identity -> workspace/member/agent resolution
  -> policy and tool exposure
  -> chat, typed workflow intent, or tool run
  -> run/control records
  -> audit, artifacts, decisions, traces, and events
```

Normal chat stays on Cloudflare Agents. Complex workflows should be represented
as typed intents and escalated to Fly/LangGraph only when graph semantics,
container execution, browser automation, or heavy tools are needed.

The generic workflow lifecycle remains:

```txt
observe -> analyze -> propose -> execute -> review
```

## Generic Subsystems

- Identity and tenancy: every durable read/write is scoped to a user,
  workspace, membership, and agent resolved from trusted server context.
- Tool registry and exposure: installed tools can be broader than the
  model-visible set; exposure is resolved by policy, agent, stage, execution
  mode, and approval state.
- Server-side execution: browser code can request, approve, and inspect tools,
  but secrets and tool credentials stay server-side.
- Run control: foreground, background, workflow, child execution, interrupts,
  cancellation, heartbeat, and recovery are tracked as durable state.
- Canonical state: outputs return as scoped decision records, managed state,
  ledgers, artifacts, audit events, traces, and UI events.
- Observability: Admin and D1 runtime summaries are product truth; Sentry and
  external tracing are downstream visibility layers.

## Important Seams

- `app/assistant.tsx`: assistant-ui runtime bridge to Cloudflare Agents.
- `lib/workbench/use-agent-connection.tsx`: loads the Cloudflare-owned session
  and active Agent connection.
- `components/assistant-ui/*`: reusable assistant-ui components.
- `components/workbench/*`: product-specific shell, sidebar, runtime hints, and
  Admin surfaces.
- `app/api/[..._path]/route.ts`: LangGraph API proxy.
- `app/api/workbench/*`: Vercel same-origin facades over Cloudflare.
- `app/api/external-signals/route.ts`: token-protected external starts,
  resumes, cron creation, and local/dev schedule dispatch.
- `backend/agent.ts`: LangGraph graph/provider seam.
- `cloudflare/control-plane/*`: Worker, D1 schema, Durable Object Agents,
  authz, policy, chat, tools, events, and traces.

## Deployment Boundary

Local development normally runs the Next app and LangGraph server with:

```bash
pnpm dev
```

The hosted dev baseline is:

```txt
Browser -> Vercel Next.js app
        -> WorkOS AuthKit session
        -> Vercel API facade
        -> Cloudflare Worker/D1 for authz, chat/session, and control state
        -> Cloudflare Agents for normal messages
        -> Fly/LangGraph only for explicit heavy execution
```

Vercel owns hosted web sign-in and browser ergonomics. Cloudflare is the
authorization, control-plane, chat coordination, and canonical-state boundary.
Fly remains the execution plane.
