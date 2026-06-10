# Workbench UI

Assistant-mk1 is an operator workbench built around chat, not a generic chatbot
wrapper. The UI should make long-running agent work inspectable without hiding
the underlying state.

Document status: the current UI is default assistant-ui chat plus a
command-accessed Admin panel. The surfaces below describe the target workbench
as runtime data matures.

## Assistant-UI Leverage Map

Use assistant-ui directly for:

- thread layout
- message rendering
- composer behavior
- attachments where the primitive fits
- tool-call rendering where stream parts map cleanly
- stream ergonomics

Wrap assistant-ui for:

- runtime creation and loading
- interrupt display and resume actions
- tool-call inspection
- artifact previews
- thread/run status coordination

Own outside assistant-ui:

- tenant scope
- secrets
- policy and execution modes
- durable run control
- workflow intents
- ledgers
- managed state
- decision records
- triggers
- external signal state
- Cloudflare/Fly orchestration

`components/assistant-ui/*` should stay product-agnostic. Workbench panels
should compose around the thread.

## Primary Layout

Current implemented layout:

- Main thread region using assistant-ui.
- Top-right auth controls.
- `/new` composer command for creating a fresh Cloudflare-owned thread.
- `/admin` composer command for the flow-first Cloudflare-owned Admin panel.
- Admin diagnostic action for `demo.inspect`.

Target layout:

- Compact run/status strip near the thread when chat/workflow state needs a
  customer-visible status surface.
- Collapsible workbench/admin panel for inspectable runtime state.
- Artifact/history drawer or tab.
- Tool/policy panel for enabled tools and recent calls.

The first screen should be the usable workbench, not a landing page.

## Surfaces

### Thread

Shows conversation, messages, reasoning where available, attachments, and
streaming model/tool activity.

Source:

- assistant-ui runtime
- LangGraph thread state
- future control-plane stream

### Run Status

Shows:

- current run status
- execution mode
- workflow stage
- heartbeat freshness
- interrupt/waiting state
- cancellation/retry availability
- parent/child run relation

Source:

- `runs.list`
- active `RunRecord`
- lifecycle events

### Interrupts And Approvals

Shows:

- requested approval
- reason
- proposed action
- execution mode
- approve/deny/resume controls
- policy context

Source:

- active run interrupt state
- workflow engine interrupt
- audit/lifecycle events

### Artifacts

Shows:

- files
- logs
- reports
- screenshots
- traces
- exports
- generated outputs

Source:

- artifact metadata
- signed/read URLs where allowed

### Execution History

Shows:

- prior runs
- lifecycle events
- tool calls
- failures
- cancellations
- resumable checkpoints when supported

Source:

- runs
- audit events
- tool calls

### Tools

Shows:

- registered tools
- exposed tools for current run
- hidden tool reasons where useful
- recent tool calls
- permissions
- execution modes
- failures

Source:

- tool metadata
- tool permissions
- tool exposure decisions
- tool call records

### Managed State And Ledger

Shows:

- domain assets the agent owns or watches
- proposed/simulated/executed/skipped/blocked/reviewed actions
- relationship to decisions, artifacts, and tool calls

Source:

- managed state repository
- ledger repository

### Decision Records

Shows:

- thesis/decision
- summary
- confidence/freshness where app-defined
- evidence and counter-evidence
- provenance
- related artifacts and runs
- status: active, superseded, stale, rejected, archived

Source:

- decision records
- artifact metadata
- provenance refs

### Workspace Runtime Context

Shows:

- active workspace
- active agent
- environment
- docs and repo assumptions
- relevant constraints
- current tool/policy footprint

Source:

- workspace context
- agent record
- context assembly metadata

### Memory And Personality

Shows:

- durable user and workspace preferences
- domain knowledge
- risk tolerance
- tone/decision style
- review cadence

Source:

- workspace context
- future memory/personality records or app extension data

### Triggers

Shows:

- schedules
- webhooks
- external event subscriptions
- last/next trigger time
- status
- target workflow type

Source:

- trigger records
- audit events

## Current UI Baseline

Implemented:

- assistant-ui thread remains primary.
- Fresh threads are created through the local `/new` composer command or the
  recent-chats sidebar, not a permanent top-right app button.
- The normal shell includes a compact server-derived runtime hint for active
  workspace, active agent/profile, model, chat state, and quick access to
  Admin when the latest runtime state needs attention.
- Admin opens as a flow-first panel from the local `/admin` composer command:
  a Cloudflare-owned request map/waterfall, chat readiness, active workspace,
  active agent/profile, latest meaningful event, and important errors are shown
  first.
- Admin supports name-only workspace create/switch, test agent creation,
  and active-agent switching for the current workspace as secondary management
  controls.
- Workspace/agent management, tool registry/run controls, diagnostic runs, raw
  ids, external WorkOS signals, recent Cloudflare events, and diagnostic
  internals stay available in collapsible Manage or Advanced details.
- `demo.inspect` remains a dev diagnostic action, not a product-level workflow.
- The empty chat state stays default assistant-ui but includes practical
  starter prompts for readiness, project planning, agent behavior, and failure
  explanation.

Next UI targets:

- Customer-facing run/status strip only when a real workflow produces state
  richer than the compact chat hint.
- Artifact/history surfaces beyond the diagnostic run snapshot.
- Interrupt display only when a workflow needs approve/deny/resume.
- Policy visibility for durable tool permissions, approvals, kill switches, and
  model-visible exposure decisions.

Avoid building every panel before one vertical slice produces real data.

## Acceptance Criteria

- User can tell what is running and why.
- User can inspect tool calls without reading raw logs.
- User can inspect durable outputs linked to a run.
- assistant-ui components remain reusable and product-agnostic.
- Workbench-specific state stays outside low-level message components.
