# Changelog

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
