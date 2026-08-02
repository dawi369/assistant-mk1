# Changelog

## 1.0.0

Production candidate extending the workbench to Operational L3 and Authority A2.

- Forward-only customer-data migrations, confirmed per-workspace retention,
  checksummed D1/R2/Durable Object export, and 30-day deletion recovery/purge.
- Snapshot-consistent exports using a bounded D1 write fence, Durable Object
  freeze, keyset staging, R2 pins, and an auditable manifest v3 snapshot cut.
- Phase-checkpointed purge failure recovery with fresh-auth owner retry,
  compare-and-set fencing, redacted errors, and preserved deletion authority.
- WorkOS Vault credential custody with API-key and OAuth 2.0 + PKCE brokerage,
  scoped provider requests, refresh CAS, health, and revocation.
- Durable mutation proposals, approvals, policy rechecks, kill switches,
  idempotency, terminal action ledger, ambiguous outcomes, and reconciliation.
- Deterministic Complex Operator mutation evidence without financial actions or
  public provider traffic.
- New lifecycle, connection, mutation, hosted Vault, and hosted mutation gates.
- Stable unpublished `@assistant-mk1/agent-sdk` SDK 1.0.0 contract with explicit
  workbench-version compatibility and normalized declaration/schema hashes.
- Deterministic synthetic release screenshots and strict Node 24/package
  metadata validation.

The tag remains blocked until the same-commit hosted checklist in
`docs/release-readiness.md` is complete.

## 1.0.0-preview.1

Developer preview of the source-available Assistant-mk1 agent workbench.

- Authenticated, tenant-scoped Cloudflare Agents chat and workbench controls.
- Code-first Agent Packs with bounded read-only workflows and policy-gated tools.
- Durable D1 run, approval, tool-call, audit, event, and artifact metadata.
- Signed Fly runner boundary for repository inspection and hardened public URL reads.
- Monotonic terminal runs, cancellation authority revocation, retry lineage, and History recovery.
- Deterministic unit, service-boundary, browser, build, documentation, and dependency gates.

Preview data contract: remote D1 records and metadata artifacts are disposable.
No forward-compatible migration, backup/restore, retention, external mutation,
encrypted credential custody, or artifact-blob guarantee is included.
