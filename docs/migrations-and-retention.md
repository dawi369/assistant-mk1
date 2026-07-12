# Migrations And Retention

Document status: current migration runbook and remaining production retention
gate. Forward-only D1 migrations are implemented; backup/restore, retention,
and customer export/delete are not.

## Current State

- `cloudflare/control-plane/migrations/` is the canonical retained D1 change
  history. Wrangler records applied files in `d1_migrations`.
- `0001_initial.sql` is the non-destructive baseline matching the current
  control-plane schema. Its `IF NOT EXISTS` clauses let a schema created before
  the ledger adopt the migration path without dropping existing rows.
- `pnpm db:cloudflare:migrate:local` and
  `pnpm db:cloudflare:migrate:remote` apply only unapplied migrations.
- `pnpm db:cloudflare:migrations:verify` creates isolated local D1 databases,
  applies migrations from empty, compares the result with the reset snapshot,
  upgrades the prior trigger baseline with retained managed-state and trigger
  rows, verifies the new webhook fields default safely, reapplies, and checks
  ledger integrity. The current chain contains four migrations through
  `0004_trigger_webhooks.sql`.
- `cloudflare/control-plane/schema.sql` remains the canonical reset snapshot.
  It intentionally starts with `DROP TABLE IF EXISTS` and is safe only for a
  deliberate local or remote dev reset.
- `pnpm db:cloudflare:rebuild:local` and
  `pnpm db:cloudflare:rebuild:remote` remain visibly destructive reset commands.
- Durable Object class migrations in `wrangler.jsonc` are separate from D1
  table migrations.

There is still no committed backup/restore procedure, retention worker, R2
artifact lifecycle policy, or customer data export/delete flow. The migration
path prevents schema deploys from requiring data loss; it does not by itself
make the dev database acceptable for retained customer history.

## Adding A D1 Change

1. Add the next numbered SQL file under
   `cloudflare/control-plane/migrations/`, for example
   `0005_add_example_status.sql`. Never edit an already-applied migration.
2. Update `cloudflare/control-plane/schema.sql` to represent the same final
   schema while preserving its reset-only `DROP TABLE` preamble.
3. Run `pnpm db:cloudflare:migrations:verify`. It must prove empty-database
   application, reset-snapshot parity, retained-row reapplication, and ledger
   integrity.
4. Run focused tests, typecheck, and lint for the changed repositories.
5. Apply locally with `pnpm db:cloudflare:migrate:local`.
6. Before a remote deploy, capture the environment's required backup/export,
   then run `pnpm db:cloudflare:migrate:remote` before deploying the Worker.

Wrangler applies each migration transactionally and records it in
`d1_migrations`. Production rollback policy is forward-fix: do not delete or
rewrite ledger entries and do not use `schema.sql` to roll back retained data.
A destructive or data-transforming migration needs an explicit backup and
recovery plan before remote application.

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

## Remaining Acceptance Gate

The repo can stop calling D1 disposable only after these are true:

- A tested backup and restore procedure exists for retained environments.
- Retention periods and pruning jobs exist for each durable data class.
- Customer/workspace export and deletion cover D1 plus future R2 state.
- Remote deploy policy requires backup evidence for risky migrations.
- Tenant isolation tests cover every newly retained table touched by a slice.
