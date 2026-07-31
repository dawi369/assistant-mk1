# Migrations, Retention, Export, And Deletion

Document status: current 1.0 implementation and operator runbook.

## Migration contract

`cloudflare/control-plane/migrations/` is the forward-only D1 ledger. The chain
contains ten migrations: the `0001` baseline, existing control-plane changes
through `0005`, and new lifecycle (`0006`), connection (`0007`), action
authority (`0008`), broker-capability (`0009`), and non-identifying deletion
receipt (`0010`) schemas. Do not rewrite a migration after it is applied.

`cloudflare/control-plane/schema.sql` is the matching reset snapshot. Its
`DROP TABLE` preamble makes it destructive and appropriate only for deliberate
dev resets. Production rollback is a forward fix.

Required checks and application order:

1. `pnpm db:cloudflare:migrations:verify`
2. encrypted D1/R2 backup and checksums for the target environment
3. `pnpm db:cloudflare:migrate:remote`
4. deploy the matching Worker
5. run same-commit lifecycle and tenant-boundary acceptance

The verifier proves empty application, adoption from the prior baseline, reset
schema parity, retained-row reapplication, and migration-ledger integrity.

## Workspace retention policy

Every workspace receives an unconfirmed privacy-oriented policy:

| Data class                             |  Default |                             Bounds |
| -------------------------------------- | -------: | ---------------------------------: |
| Raw chat messages                      |  90 days |                        1–3650 days |
| Run and tool payloads                  |  90 days |                        1–3650 days |
| Artifacts                              |  90 days |                        1–3650 days |
| Operational events                     |  30 days |                        1–3650 days |
| Runtime traces                         |  14 days |                        1–3650 days |
| Audit, policy, approval, action ledger | 365 days | minimum 365 while workspace exists |

Owners/admins manage and confirm the policy through
`GET/PATCH /workbench/retention-policy`. Mutation remains unavailable until an
owner/admin confirms it. Scheduled sweeps are tenant-policy-aware, bounded,
audited through durable state changes, and safe to retry. R2 objects are deleted
before their D1 metadata is tombstoned.

## Asynchronous export

Owners/admins use:

- `POST /workbench/data-exports`
- `GET /workbench/data-exports/:id`
- `GET /workbench/data-exports/:id/download`

The durable job moves through queued, running, completed, failed, cancelled, or
expired states. It publishes only after a complete ZIP is assembled in private
R2. The archive contains a checksummed `manifest.json`, paginated D1 NDJSON,
Durable Object thread state, and original R2 artifact bodies. Credential
payloads, Vault references, OAuth state, webhook hashes, and other secret state
are omitted. Any missing object or checksum mismatch fails the job rather than
publishing a partial archive. Downloads are private, `no-store`, owner/admin
only, audited, and expire after seven days.

The legacy bounded `GET /workbench/data-export` remains for compatibility and is
not the production completeness contract.

## Workspace deletion

The lifecycle is `active → quarantined → purging → purged|failed`.

An owner must provide the exact workspace name and a WorkOS `auth_time` no older
than five minutes. Quarantine immediately blocks normal tenant access, pauses
triggers/webhooks, cancels active runs and approvals, enables the workspace kill
switch, and revokes/deletes Vault credentials. Credential revocation is
irreversible.

For 30 days, only the initiating owner may inspect deletion status or recover.
Recovery restores retained content and access, but not credentials, webhook
secrets, approvals, or enabled triggers. At the deadline, the resumable purge
removes Durable Object state before D1 thread identities, then R2 objects,
OAuth state, connection/action state, and remaining tenant D1 rows. Only a
non-identifying deletion receipt remains.

## Backup and restore

`pnpm db:cloudflare:backup:verify` proves deterministic D1 backup/restore against
an isolated database. Before a hosted migration, create a mode-0600 remote
export, record its SHA-256, environment, commit, operator, timestamp, and table
counts, and restore only into a fresh recovery database. D1 export is not R2 or
Durable Object disaster recovery; release evidence must separately verify those
classes.

## Release evidence

- `pnpm conformance:data-lifecycle`
- fresh-database forward migration and recovery rehearsal
- same-commit D1/R2/DO export, quarantine/recovery, and time-shifted purge
- retention backlog and lifecycle job-failure dashboards/alerts

Legal hold, regulated-industry retention, multi-region replication, and
customer-managed backup destinations remain outside 1.0.
