# Migrations And Retention

Document status: current production gate. The live control-plane schema is
still a rebuildable dev baseline; this file defines what must exist before
assistant-mk1 keeps real customer/user data across schema changes.

## Current State

- `cloudflare/control-plane/schema.sql` is the canonical early-dev D1 schema.
- The schema intentionally starts with `DROP TABLE IF EXISTS` and is safe only
  for deliberate local or remote dev resets.
- `pnpm db:cloudflare:rebuild:local` and `pnpm db:cloudflare:rebuild:remote`
  are destructive reset commands.
- `cloudflare/control-plane/wrangler.jsonc` has Durable Object class
  migrations for `WorkbenchThreadChatAgent` and `WorkbenchSessionAgent`; it is
  not a D1 table migration system.
- There is no committed retained-data migration runner, retention worker, R2
  artifact lifecycle policy, or customer data export/delete flow yet.

## North-Star Requirement

Before retained real user data exists, Cloudflare must have a forward-only D1
migration path and explicit retention rules for every durable state bucket:

- identity and workspace records
- memberships and agent records
- chat threads, chat runs, and Durable Object hot state mirrors
- workflow intents, control runs, tool calls, approvals, traces, events, and
  audit records
- artifact metadata in D1 and future artifact blobs in R2
- future ledgers, managed state, memory, and decision records

Until that exists, remote D1 remains disposable dev validation state and should
not be treated as durable customer history.

## Migration Path

1. Add a D1 migration directory such as
   `cloudflare/control-plane/migrations/` with numbered forward-only SQL files.
2. Add a `schema_migrations` table or use the Cloudflare D1 migrations ledger,
   then make every remote schema change idempotent and auditable.
3. Keep `schema.sql` as the local reset snapshot generated from or reviewed
   against the applied migrations.
4. Add non-destructive scripts for local and remote D1 migration application.
   The existing rebuild scripts should remain visibly destructive.
5. Add CI or smoke coverage that applies migrations from an empty database and
   from the previous retained baseline.
6. Write a rollback policy based on forward fixes, backups, and exportable
   state. Do not rely on destructive reset for retained environments.

## Retention Path

Define retention by data class before accepting durable customer history:

- Identity, workspace, membership, and agent records: retained while the
  account/workspace exists, with delete/export paths.
- Chat and run state: bounded by workspace policy, with compact summaries kept
  longer than raw message/tool payloads.
- Audit events and policy decisions: immutable enough for accountability, but
  redacted and scoped to tenant visibility.
- Runtime traces and low-level events: shorter operational retention, sampled
  or pruned when they stop being useful for debugging.
- Artifact metadata: retained with run history; future R2 blobs need lifecycle
  rules, signed reads, size limits, and deletion hooks.

## Acceptance Gate

The repo can stop calling D1 disposable only after these are true:

- New schema changes land as forward migrations instead of direct reset-only
  edits.
- Remote deploy docs separate migrate from rebuild.
- CI proves migrations and package verification on a clean checkout.
- Tenant isolation tests cover every newly retained table touched by a slice.
- The docs state retention periods and deletion/export behavior for each
  durable class.
