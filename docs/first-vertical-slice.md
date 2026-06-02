# First Vertical Slice

The first implementation slice should prove the architecture with minimal risk.
It should not require real Cloudflare resources, D1/R2 migrations, secret
storage, or mutation-capable tools.

## Goal

Prove this path:

```txt
manual or external signal
  -> trusted tenant scope fixture
  -> WorkflowIntent
  -> RunRecord
  -> mock typed tool call
  -> lifecycle events
  -> audit/artifact/decision output
  -> workbench status surface
```

## User Story

As a user, I can trigger a safe workflow, watch its run status, inspect the tool
call and artifact it produced, and ask what happened without relying on hidden
transcript state.

## In Scope

- Temporary trusted dev tenant scope.
- One workflow intent type, such as `demo.inspect`.
- One run record.
- One harmless typed tool.
- One tool call record.
- One artifact metadata record.
- One audit event sequence.
- Optional decision record if the tool result includes a durable conclusion.
- Minimal workbench run/status surface around the assistant-ui thread.

## Out Of Scope

- Real Cloudflare resources.
- D1/R2 migrations.
- Real secret custody.
- Live external mutation.
- Production auth.
- Multiple tenants in real auth.
- Full UI shell.
- Arbitrary user-installed hooks.

## Runtime Flow

1. User clicks a local demo action or sends an authenticated staging signal.
2. Runtime derives fixture trusted scope.
3. Runtime creates `WorkflowIntent`.
4. Policy verifies `dry_run` or `ask` mode.
5. Runtime creates `RunRecord` with status `queued`.
6. Run transitions to `running`.
7. Tool exposure resolver exposes only the demo tool.
8. Runtime records tool call started.
9. Demo tool returns structured output.
10. Runtime creates artifact metadata for the demo output.
11. Runtime records tool call finished.
12. Runtime appends audit events.
13. Runtime optionally creates a decision record.
14. Run transitions to `completed`.
15. UI shows run status, tool call summary, artifact, and audit timeline.

## Demo Tool Requirements

The first tool should:

- run server-side
- require no secret
- support `ask` or `dry_run`
- produce deterministic output
- return structured data
- produce one small artifact metadata record
- complete quickly
- be cancellable in contract even if no long process exists yet

## UI Requirements

Use assistant-ui for:

- thread
- composer
- messages
- stream rendering

Add product-specific UI around it for:

- current run status
- execution mode
- tool call summary
- artifact link/preview placeholder
- audit event summary

## Acceptance Criteria

- `pnpm typecheck` passes.
- `pnpm build` passes.
- Local app can trigger the demo slice.
- UI shows `queued -> running -> completed`.
- Tool result is structured.
- Audit/artifact records are visible through the workbench surface.
- No secrets are required or exposed.
- The implementation can later swap mock storage for a data-client backing
  implementation without changing the UI contract.
