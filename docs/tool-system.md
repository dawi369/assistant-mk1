# Tool System

Assistant-mk1 tools are server-side capabilities with typed inputs, typed
outputs, policy checks, audit behavior, and UI inspection. The model should see
only the tools allowed for a specific scoped run.

## Assistant-UI Boundary

assistant-ui should render streaming tool-call states where the stream shape
fits. Assistant-mk1 owns the durable tool system around that rendering:

- tool registry and metadata
- tenant-scoped enablement
- policy and execution modes
- secret access
- redaction
- tool-call records
- artifacts and logs
- audit events
- CLI/OSS process behavior

Low-level assistant-ui tool-call components should stay reusable. Workbench
panels can show durable tool history, permission state, policy state, and
artifacts around the thread.

## Registration Vs Exposure

Registration means the platform knows a tool exists.

Exposure means a specific model run can see and call the tool.

The durable registry may contain many tools. The tool exposure resolver narrows
that list based on:

- tenant scope
- agent/workspace configuration
- tool permission record
- workflow stage
- execution mode
- policy reference
- parent/child run context
- runtime platform constraints

The resolver should return visible tools plus explanation metadata for hidden
or exposed decisions.

The provisional runtime contract is `ToolExposureResolver`. It receives
candidate runtime tool definitions and scoped run context, then returns
visibility decisions for that run.

## Tool Definition

A runtime tool should declare:

- stable name
- human-readable description
- kind or family
- input contract
- output contract
- required secrets
- supported execution modes
- timeout behavior
- cancellation behavior
- logging and redaction behavior
- artifact outputs
- execution function

Runtime definitions may contain functions and must not be persisted directly.
Durable registries store serializable metadata instead.

## Tool Families

Supported families:

- Native TypeScript tools.
- API-backed tools.
- CLI-backed tools.
- OSS package wrappers.
- Git submodule or vendored package adapters.
- Browser automation tools.
- Workflow-engine tools that call another service.

All families use the same framework boundary: scoped input, policy check,
server-side execution, structured output, audit, and artifacts.

## Execution Modes

- `ask`: model may reason and propose but cannot mutate external state.
- `dry_run`: tool may simulate and return proposed effects.
- `execute`: tool may mutate only when policy allows it.

Mutation-capable tools must support `dry_run` before `execute`. If a provider
cannot dry-run safely, the adapter must document that limitation and stay
disabled for live mutation until policy explicitly allows it.

## Tool Call Lifecycle

```txt
tool requested
  -> exposure check
  -> policy check
  -> secret lookup if needed
  -> record ToolCall started
  -> execute with timeout/cancellation
  -> create artifacts/logs if needed
  -> record ToolCall finished
  -> append audit event
  -> return structured result to workflow/model/UI
```

Failure still records a finished tool call with error summary and audit event.

## CLI And OSS Adapters

CLI/OSS tools must define:

- executable or package entrypoint
- working directory rules
- env allowlist
- timeout
- cancellation strategy
- stdout/stderr capture policy
- redaction rules
- artifact promotion rules
- deterministic dry-run mode when mutation is possible

Do not pass broad environment variables or credentials into CLI tools. Provide
only scoped, approved secrets required by the tool.

## Structured Output

Tool output should be structured enough for the UI to display:

- status
- summary
- important values
- artifacts
- follow-up actions
- retryability
- policy blocks
- redacted error details

The UI should not parse prose to determine what happened.

## Redaction

Never expose secrets in:

- model-visible tool output
- browser responses
- logs
- artifacts
- audit summaries
- error messages

Adapters should redact before writing artifacts and again before returning data
to the model or UI.

## Current Demo Tool

The current demo tool should stay harmless and deterministic until production
policy, auth, and secret custody are ready. Required shape:

- Native TypeScript inspection tool.
- Supports `ask` and `dry_run`.
- Produces a structured output summary.
- Produces one small artifact metadata record.
- Emits lifecycle and audit events.

Do not start with a mutation-capable external integration.

## Current Read-Only URL Tool

`url.inspect` is the first non-demo adapter. It is Admin-triggered only in v0;
it is not exposed to the model-visible tool list yet.

Behavior:

- Accepts `{ url }`.
- Supports `dry_run` only.
- Uses policy reference `tool-admin-readonly-v0`.
- Allows only public `http` and `https` URLs.
- Rejects embedded credentials and obvious local, private, or metadata hosts.
- Uses a timeout and bounded response read.
- Returns structured status, content metadata, timing, optional page title, and
  retryability.
- Records workflow intent, run, tool call, artifact, audit events, and
  control-plane events in Cloudflare-owned state.

This slice proves tool adapter execution and Admin visibility. Durable
permission records, approvals, kill switches, secret custody, and
model-visible tool exposure remain policy-layer work.
