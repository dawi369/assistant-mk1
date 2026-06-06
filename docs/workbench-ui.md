# Workbench UI

Assistant-MK1 is an operator workbench built around chat, not a generic chatbot
wrapper. The UI should make long-running agent work inspectable without hiding
the underlying state.

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

First useful layout:

- Main thread region using assistant-ui.
- Compact run/status strip near the thread.
- Right-side or collapsible workbench panel for inspectable state.
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

## First UI Slice

The first implementation should add only enough UI to prove the architecture:

- assistant-ui thread remains primary.
- run/status strip shows current run.
- side panel shows artifacts, audit, and tool call summary for the mock vertical
  slice.
- interrupt display supports approve/deny only if the vertical slice needs it.

Avoid building every panel before one vertical slice produces real data.

## Acceptance Criteria

- User can tell what is running and why.
- User can inspect tool calls without reading raw logs.
- User can inspect durable outputs linked to a run.
- assistant-ui components remain reusable and product-agnostic.
- Workbench-specific state stays outside low-level message components.
