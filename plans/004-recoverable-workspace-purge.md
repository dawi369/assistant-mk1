# Plan 004: Make failed workspace purges recoverable

> **Executor instructions**: Preserve purge cursor progress and deletion
> authority. A retry must resume idempotently; it must never recreate customer
> data or silently mark a partial purge complete. Update `plans/README.md`.
>
> **Drift check**: `git diff --stat 5eb783a..HEAD -- cloudflare/control-plane/src/workspace-data-lifecycle.ts cloudflare/control-plane/src/index.ts app/api/workbench/workspace-deletion lib/workbench/cloudflare-control-plane-client.ts lib/workbench/workbench-types.ts components/workbench/workbench-workspace-panel.tsx cloudflare/control-plane/migrations cloudflare/control-plane/schema.sql tests/e2e/production-data-lifecycle.spec.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH - deletion retry must not weaken authorization or idempotency
- **Depends on**: Plan 003
- **Category**: bug
- **Planned at**: `5eb783a`, 2026-08-01

## Why this matters

Automatic lifecycle processing exhausts after three attempts, marks the purge
job and workspace `failed`, and emits an alert. No supported API or UI can resume
that partially completed deletion, leaving operators dependent on manual D1
repair despite the documented resumable-purge guarantee.

## Current state

- `workspace-data-lifecycle.ts:450-519` converts the third failure to terminal
  `failed` and marks a purging workspace failed.
- `workspace-data-lifecycle.ts:851-866` deletion status accepts only
  `quarantined|purging`; failed deletion becomes invisible.
- `cloudflare/control-plane/src/index.ts:225-231` allows quarantined recovery
  routes but not failed workspaces.
- `app/api/workbench/workspace-deletion/route.ts:20-34` demonstrates the correct
  WorkOS `auth_time` injection pattern for destructive authority.

## Scope

**In scope**:

- new migration `0013_data_job_manual_recovery.sql` and reset schema
- workspace lifecycle service/routes/types/client
- Workspace deletion/recovery UI
- operator alert/audit integration
- lifecycle unit, integration, and browser tests

**Out of scope**: restoring purged content, credential recovery, automatic
unbounded retries, bypassing fresh WorkOS authentication, or DB-console runbooks
as the primary recovery path.

## Steps

1. Extend job evidence with `last_failed_at`, `manual_retry_count`, and a redacted
   stable error code. Preserve `cursor_json`, completed phase markers, original
   creator, purge deadline, and cumulative attempts. Update migration parity.

2. Add `POST /workbench/workspace-deletion/retry` through the Vercel facade.
   Require the initiating owner, exact workspace-name confirmation, WorkOS
   `auth_time` no older than five minutes, workspace status `failed`, and latest
   purge job status `failed`. Cross-tenant and non-initiator access returns 404.

3. In one CAS batch, transition workspace `failed -> purging`, job
   `failed -> queued`, clear lease ownership, increment `manual_retry_count`,
   retain the cursor, append audit/event evidence, and acknowledge/supersede the
   previous failure alert. A concurrent retry returns 409 and cannot create a
   second purge job.

4. Expand deletion status to `quarantined|purging|failed`, returning only redacted
   phase, attempt count, last error code, timestamps, and `canRetry`. Keep all
   normal workspace routes blocked. Recovery of retained content remains allowed
   only before destructive purge began; once cursor phases show deletion, expose
   retry but not recovery.

5. Add a recovery card to the Workspace surface. It explains that credentials
   remain revoked, shows the failed phase, requires the exact name again, sends
   the retry through the fresh-auth facade, polls progress with a cap, and links
   the durable operator alert. Never expose raw job payloads.

6. Add deterministic fault injection in explicit E2E mode for every purge phase:
   DO purge, R2 deletion, connection/Vault cleanup, D1 tenant rows, and receipt
   creation. Retry must resume at the recorded phase, tolerate already-missing
   objects, produce one non-identifying receipt, and end `purged`.

7. Add an authenticated platform-operator recovery command that invokes the same
   CAS transition without reading customer content. It must require an existing
   critical alert and record operator identity/reason. Keep it out of normal
   workspace APIs and document it as the orphaned-owner escape hatch.

## Done criteria

- A failed purge is visible and recoverable without direct database edits.
- Manual retry preserves progress and produces no duplicate purge job or receipt.
- Unauthorized/cross-tenant retry returns 404; stale reauth returns 403.
- Normal workspace execution remains blocked throughout failed and retry states.
- Credentials, webhook secrets, approvals, and triggers are never restored.
- Lifecycle conformance, production lifecycle E2E, migration verification,
  typecheck, lint, build, and `git diff --check` pass.

## STOP conditions

- Stop if the existing purge cursor cannot distinguish whether an external delete
  was dispatched; add explicit phase receipts before permitting retry.
- Stop if a retry could repeat a non-idempotent Vault/provider operation without
  a safe read/reconcile operation.
- Stop if failed-workspace identity resolution would expose any route other than
  deletion status/retry and the narrowly authorized operator command.

## Maintenance notes

Automatic retries remain capped. Manual retries are deliberate authority events,
not a way to hide a persistent outage. Alert dashboards should group attempts by
the original purge job ID.
