# Migrations And Retention

Document status: current migration and retention runbook. Forward-only D1
migrations, artifact lifecycle metadata, and bounded retention workers are
implemented. Backup/restore and customer export/delete remain production gates.

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
  ledger integrity. The current chain contains five migrations through
  `0005_artifact_retention.sql`.
- `cloudflare/control-plane/schema.sql` remains the canonical reset snapshot.
  It intentionally starts with `DROP TABLE IF EXISTS` and is safe only for a
  deliberate local or remote dev reset.
- `pnpm db:cloudflare:rebuild:local` and
  `pnpm db:cloudflare:rebuild:remote` remain visibly destructive reset commands.
- Durable Object class migrations in `wrangler.jsonc` are separate from D1
  table migrations.

`0005_artifact_retention.sql` adds workspace retention policy rows, explicit
artifact storage and checksum metadata, expiry/tombstone fields, and a default
90-day artifact expiry. The scheduled Worker runs bounded artifact, operational
event, and runtime-trace sweeps. R2 deletion happens before the D1 artifact is
tombstoned; a missing or failed R2 binding leaves metadata live for retry.

The deterministic local backup/restore verifier and bounded scoped export are
committed. There is still no hosted restore evidence or executable customer
deletion flow. Wrangler declares and locally exercises `ARTIFACTS`, but the
named R2 bucket still has to be provisioned per hosted environment. These gaps
mean the foundation does not yet make hosted dev state acceptable as retained
customer history.

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

## Backup And Restore

`pnpm db:cloudflare:backup:verify` creates an isolated migration-built D1
database, writes retained sentinel records, produces a mode-0600 SQL backup,
restores it into a fresh SQLite database, and verifies the tenant scope,
artifact lifecycle metadata, payload, and migration ledger. The temporary
backup is checksummed and removed in `finally`. This deterministic check runs in
`verify:fast`.

Before a risky hosted migration, an operator must create an ignored backup:

```bash
mkdir -p output/backups
pnpm exec wrangler d1 export assistant_mk1_dev --remote \
  --config cloudflare/control-plane/wrangler.jsonc \
  --output output/backups/d1-before-<commit>.sql --skip-confirmation
shasum -a 256 output/backups/d1-before-<commit>.sql
```

Record the environment, commit, timestamp, Wrangler identity, row-count checks,
path, and SHA-256 in the release evidence. The export contains customer data:
keep it encrypted and access-controlled outside the checkout and delete the
local copy after evidence is recorded.

Restore drills target a newly provisioned recovery D1 database using a temporary
Wrangler configuration. Never execute a backup over the active database. Apply
the export to the recovery database, compare migration ledger and per-table row
counts, smoke tenant-scoped reads, and only then make a separate cutover
decision. Remote export, recovery-database creation, restore, and cutover are
operator actions and are intentionally not performed by the local verifier.

R2 disaster recovery is not satisfied by the D1 export. Before blob storage is
enabled for retained customers, provision bucket versioning or replication and
complete a separate object restore drill whose manifest is reconciled against
`control_artifacts.storage_key` and `content_sha256`.

## Customer Export And Deletion Inventory

Workspace owners/admins can call `GET /workbench/data-export` to download a
private, no-store JSON export of the active `userId + workspaceId` scope. It
includes bounded D1 collections plus base64-encoded R2 artifact bodies with
their stored SHA-256 values. Nonces and trigger secret hashes are deliberately
excluded. The export fails instead of returning a partial result when a
collection exceeds 1,000 rows, R2 is unavailable, an object is missing, or the
combined blob payload exceeds 10 MiB. Successful exports write audit evidence.

This is the correct small-workspace preview path, not the final streaming export
format. It explicitly reports Durable Object chat bodies/hot coordination state
as unsupported until an export seam exists for those classes.

`GET /workbench/data-deletion-plan` returns counts for the same D1 collections
and R2 objects. It is intentionally non-executable and names the two remaining
blockers: Durable Object deletion and a resumable, two-phase destructive job.
This inventory prevents the product from claiming complete deletion while
preserving the current read-only capability boundary.

## Retention Path

The implemented defaults are 90 days for standard artifacts, 30 days for
control-plane operational events, and 14 days for runtime traces. Workspace
owners and admins may change all three through
`GET/PATCH /workbench/retention-policy`; values are bounded to 1–3650 days and
changes are audited. `permanent` artifacts do not receive an automatic expiry.
The authenticated blob-upload route accepts only `standard`; `permanent` is a
reserved internal lifecycle class until a separate admin policy exists.

The remaining data classes still need explicit policy before accepting durable
customer history:

- Identity, workspace, membership, and agent records: retained while the
  account/workspace exists, with delete/export paths.
- Chat and run state: bounded by workspace policy, with compact summaries kept
  longer than raw message/tool payloads.
- Audit events and policy decisions: define the accountability and regulatory
  period before pruning is allowed.
- Run and chat history: define raw versus summarized history periods.

R2 artifact writes are capped at 5 MiB in the initial mediated API, store a
SHA-256 digest, and use tenant-scoped object keys. Reads re-check the D1 tenant
scope and return private, no-store responses. Metadata is capped at 32 KiB. An
atomic D1 predicate caps each active tenant scope at 1,000 R2 objects and 100
MiB total; a rejected or failed metadata write removes the staged R2 object.
Larger streaming artifacts remain
a follow-up contract rather than bypassing Cloudflare mediation. The Level 3
browser boundary exercises create, scoped read, History projection, export
integrity, policy shortening, scheduled deletion, and post-expiry denial against
the local R2 implementation.

## Remaining Acceptance Gate

The repo can stop calling D1 disposable only after these are true:

- A tested backup and restore procedure exists for retained environments.
- Retention periods and pruning jobs exist for each durable data class; artifact,
  operational-event, and runtime-trace classes are implemented.
- Customer/workspace export and deletion cover D1, R2, and Durable Object state;
  bounded D1/R2 export and a non-executable deletion inventory are implemented.
- Remote deploy policy requires backup evidence for risky migrations.
- Tenant isolation tests cover every newly retained table touched by a slice.
