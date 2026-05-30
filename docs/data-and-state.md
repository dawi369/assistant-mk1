# Data And State

Assistant-MK1 needs clear ownership for every kind of state. Summaries are indexes, not truth. Durable state and linked artifacts are the source of truth.

## Storage Map

- Durable Object state or Durable Object SQLite: per-agent hot state, active session state, coordination locks, and wakeup metadata.
- D1: relational app and control-plane data.
- R2: blobs and artifacts.
- Workflow backend: in-flight workflow state for complex execution.

## Canonical Entities

- Tenant scope: `userId` and `workspaceId`.
- User: authenticated person.
- Workspace: project/team/account boundary.
- Agent: configured assistant instance within a workspace.
- Thread: conversation or task continuity.
- Workflow intent: typed escalation request.
- Decision record: durable reasoning/provenance record.
- Tool definition: registered tool contract and policy.
- Tool call: one execution attempt against a tool.
- Audit event: immutable record of important state changes and actions.
- Artifact: file, log, trace, report, screenshot, export, or bundle.
- Trigger: schedule, webhook, external event, or tool event that can wake work.
- Managed state: domain assets the agent owns or monitors.
- Ledger entry: proposed, executed, skipped, blocked, or reviewed action.

## D1 Responsibilities

D1 should hold relational data:

- Users, workspaces, memberships, and roles.
- Agents and configuration.
- Tool registry, permissions, and execution policy metadata.
- Threads, workflow intents, decision records, audit events, triggers, managed state, and ledger entries.
- Artifact metadata and R2 object references.

## R2 Responsibilities

R2 should hold object data:

- Tool logs and traces.
- Generated reports and research bundles.
- Screenshots and browser artifacts.
- Exported ledgers or decision archives.
- Large workflow outputs.

R2 should not be treated as the app database. Store searchable metadata in D1 and blobs in R2.

## Workflow Backend Responsibilities

Workflow engines may keep in-flight execution state, retries, checkpoints, and intermediate step state. Final important outputs must be written back to canonical D1/R2-backed state so the conversational agent can explain them later.

## Access Pattern

Cloudflare should mediate application data access for workflow and tool execution first.

Fly/LangGraph services should receive a scoped workflow context, then use a data client with operations such as:

- Load workspace context.
- Read decision records.
- Create or supersede decision records.
- Append audit events.
- Create artifact metadata.
- Patch managed state.
- Record ledger entries.

The data client enforces `userId + workspaceId`, permissions, redaction, and audit. Initially it is backed by mediated Cloudflare APIs.

Future optimization: the backing implementation may switch to scoped direct D1/R2 access only for proven hot paths. That must not change the workflow-facing API or bypass tenant checks, redaction, or audit events.
