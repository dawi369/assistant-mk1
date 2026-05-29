# Fly Tool Runners

Fly is the preferred heavy execution plane for Assistant-MK1.

## Role

Fly services should run work that does not belong in Cloudflare Workers:

- CLI tools.
- OSS packages and git submodules.
- Python tools.
- Browser automation.
- LangGraph workflow workers.
- Long-running jobs.
- Native dependencies.
- Private network services.

Cloudflare coordinates; Fly executes.

Fly does not own the user-facing stream. Tool runners and LangGraph services report progress to Cloudflare through callbacks or scoped status writes. Cloudflare then streams status and results to the frontend.

## Tool Call Boundary

All tool calls from the control plane to Fly should be signed, typed, tenant-scoped, and auditable.

Minimum request shape:

```json
{
  "scope": { "userId": "user-id", "workspaceId": "workspace-id" },
  "intentId": "intent-id",
  "toolName": "tool.name",
  "risk": "medium",
  "dryRun": true,
  "input": {}
}
```

The Fly service must:

- Verify the request signature.
- Validate tenant scope and tool permission.
- Enforce timeout and cancellation policy.
- Enforce dry-run and approval requirements.
- Redact secrets from logs and responses.
- Return structured output and artifact references.
- Write or return audit summaries for persistence.

## Mediated State Access

Fly services should not use broad D1/R2 credentials. The initial implementation uses mediated Cloudflare APIs for app-state reads and writes.

Preferred access pattern:

```txt
Fly/LangGraph workflow
  -> scoped Cloudflare data API
  -> policy/auth/redaction/audit checks
  -> D1/R2/DO-backed state
```

Future optimization: scoped direct D1/R2 access may be considered only after a measured performance or reliability problem. It must use the same scoped data-client interface and produce the same audit events. It is not part of the initial implementation.

## LangGraph On Fly

LangGraph can run on Fly as a workflow service for complex graph-shaped work. In that model, Cloudflare creates a typed workflow intent, policy approves it, and Fly executes the LangGraph workflow. Final outputs must return to canonical state: decision records, audit events, artifacts, ledgers, and managed state.

LangGraph workflows may need to read and write context. The initial implementation should do that through a scoped data client backed by mediated Cloudflare APIs, not through global database access.

## Deployment Modes

- Current dev/staging mode: one Fly app can run Next and LangGraph together for smoke tests.
- Target execution mode: one or more Fly services run tool runners and LangGraph workflow workers behind signed internal APIs.

Do not store important durable state on a Fly filesystem unless the storage strategy explicitly says so.
