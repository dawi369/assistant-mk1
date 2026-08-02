# Plan 003: Make workspace exports snapshot-consistent

> **Executor instructions**: This is a customer-data correctness change. Add
> characterization tests first, use a forward migration, and do not weaken the
> export claim to avoid implementing the fence. Update `plans/README.md` when
> done.
>
> **Drift check**: `git diff --stat 5eb783a..HEAD -- cloudflare/control-plane/src/workspace-data-lifecycle.ts cloudflare/control-plane/src/workspace-data-lifecycle.test.ts cloudflare/control-plane/src/session-agent.ts cloudflare/control-plane/src/thread-chat-agent.ts cloudflare/control-plane/src/artifact-lifecycle.ts cloudflare/control-plane/schema.sql cloudflare/control-plane/migrations docs/migrations-and-retention.md tests/e2e/production-data-lifecycle.spec.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH - introduces a tenant write fence across D1, DO, and R2
- **Depends on**: none
- **Category**: migration
- **Planned at**: `5eb783a`, 2026-08-01

## Why this matters

The production contract says an export is complete across D1, R2, and Durable
Objects. Today it uses unordered live `LIMIT/OFFSET` queries, then separately
reads DOs and R2. Concurrent writes can produce duplicates, omissions, or an
archive whose components never represented one coherent workspace state.

## Chosen consistency contract

An export represents an immutable workspace snapshot captured at `snapshotAt`.
Snapshot acquisition may briefly reject new workspace writes with HTTP 423 and
code `workspace_export_in_progress`; archive assembly happens after the fence is
released. A write racing the fence must be wholly before the snapshot or wholly
rejected—never partially represented. Reads and export-status polling continue.

## Current state

- `workspace-data-lifecycle.ts:32-94` declares live table queries without stable
  keys or ordering.
- `workspace-data-lifecycle.ts:123-140` paginates them with `LIMIT/OFFSET`.
- `workspace-data-lifecycle.ts:185-270` reads DO messages and R2 artifacts after
  D1, with no cross-resource cut.
- `control_data_jobs.cursor_json` and `result_json` already support resumable
  phases; preserve that pattern.
- Migrations are forward-only through `0011`; `schema.sql` is reset-only.

## Scope

**In scope**:

- new migration `0012_consistent_workspace_exports.sql`
- `cloudflare/control-plane/schema.sql`
- lifecycle, authz/write-gate, chat DO, artifact-retention, and run-publication
  modules required to enforce the fence
- lifecycle and structural tests
- production lifecycle Playwright journey
- lifecycle, DB-contract, readiness, and conformance docs

**Out of scope**: database replacement, whole-database Cloudflare management API
exports, down migrations, import/restore UI, or holding the write fence while ZIP
compression and upload run.

## Steps

1. Add characterization tests that run concurrent writes during each current
   export phase and demonstrate the failure: offset page shift, artifact deletion,
   late artifact publication, and DO message arrival. Keep them isolated until
   the new path is implemented.

2. Add migration `0012` with:
   - `control_workspace_write_fences(workspace_id PK, job_id, kind, status,
acquired_at, lease_expires_at, version)`;
   - `control_data_export_rows(job_id, collection_name, row_key, payload_json,
PRIMARY KEY(job_id, collection_name, row_key))`;
   - `control_data_export_objects(job_id, artifact_id, storage_key,
content_sha256, size_bytes, status, PRIMARY KEY(job_id, artifact_id))`;
   - indexes for job cleanup and active-fence lookup.
     Update reset schema and migration parity tests. Do not rewrite `0001`-`0011`.

3. Introduce one control-plane write-fence helper. Every canonical workspace
   mutation must either include `NOT EXISTS(active fence)` in its final D1 CAS
   batch or acquire a scoped write permit whose version is rechecked at commit.
   Cover chat/thread creation, workflow/run finalization, callbacks, managed
   state, tools, approvals, triggers/webhooks, connections, actions, retention,
   membership/agent changes, and artifact publication. Do not rely only on an
   early request-time read.

   **Verify**: structural tests enumerate mutation modules and fail when a new
   durable write path omits the shared fence guard.

4. Implement snapshot acquisition as resumable phases in `cursor_json`:
   `awaiting_quiescence -> fenced -> do_frozen -> d1_materialized -> r2_pinned -> released -> assembling`.
   Wait for running workflows/actions to reach terminal state before fencing;
   requeue instead of cancelling them. Acquire the fence by CAS. Existing open
   chat DOs receive an authenticated freeze command and return immutable message
   snapshots/checksums. Reject new chat messages while frozen.

5. In one D1 batch, materialize every export collection into
   `control_data_export_rows` with explicit JSON fields and deterministic
   `row_key`. Include the frozen DO snapshot descriptors and artifact metadata;
   pin referenced R2 keys so retention cannot remove them. A schema-coverage test
   must fail when an exportable table/column is added without updating the export
   projection or explicit omission list.

6. Release the write fence and unfreeze all DOs in `finally` only after D1 rows
   and R2 pins are durable. If acquisition fails, resume from the recorded phase;
   if release partially fails, a scheduled recovery worker must expire the lease,
   finish unfreezing, and emit an operator alert. Never publish an archive from a
   partially captured snapshot.

7. Build the ZIP exclusively from snapshot rows and pinned immutable R2 objects,
   using ordered keyset pagination `(collection_name, row_key)`. Remove live
   `LIMIT/OFFSET` archive reads. Manifest v3 includes `snapshotId`, `snapshotAt`,
   fence duration, per-collection counts, per-file hashes, object hashes, and
   explicit omissions. Clean snapshot rows/pins after completion, expiry, or
   cancellation; retain enough result metadata to audit the download.

8. Add service/browser races proving:
   - a pre-fence write is included;
   - a post-fence write receives 423 and makes no partial state;
   - frozen DO messages do not slip into/out of the cut;
   - retention cannot delete pinned R2 bodies;
   - archive assembly resumes after Worker restart;
   - checksum/missing object fails the job;
   - cross-tenant reads/downloads remain 404;
   - the workspace is writable again after success and every failure phase.

## Done criteria

- Archive generation contains no live export `OFFSET` query.
- Manifest counts exactly match staged rows and original R2 bodies.
- Every accepted mutation is entirely before or after the snapshot cut.
- The fence is held only for snapshot acquisition, not ZIP assembly.
- No failure can leave a workspace indefinitely fenced or a DO frozen.
- Migration verification, lifecycle conformance, action/connection/L2/L3
  conformance, unit tests, E2E, typecheck, lint, and build pass.

## STOP conditions

- Stop if any canonical workspace mutation cannot be fenced at its durable commit
  boundary; list that path instead of claiming consistency.
- Stop if R2 artifact bodies are mutable in place; introduce immutable versioned
  keys before relying on pins.
- Stop if a DO cannot produce an immutable snapshot and freeze acknowledgment.
- Stop if D1 batch/materialized payload limits require an unbounded single write;
  preserve the fence and design bounded staging chunks with a verified cut.

## Maintenance notes

The export projection is a schema contract. Future migrations must update the
coverage test. Reviewers should focus on forgotten write paths, fence expiry,
and cleanup after partial failure—not ZIP formatting.
