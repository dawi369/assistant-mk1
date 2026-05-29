# Secrets And Risk

Assistant-MK1 must assume tools can be powerful. Secret custody and risk policy are framework primitives, not app-specific extras.

## Secret Custody

Secrets must be:

- Encrypted at rest.
- Scoped by `userId` and `workspaceId`.
- Revocable.
- Server-side only.
- Available only to approved tools.
- Never returned to browser API responses.
- Redacted from logs, artifacts, traces, and model-visible content unless explicitly safe.

Secrets include model keys, trading keys, API tokens, webhook signing keys, OAuth refresh tokens, and any credential that can spend money, move assets, mutate production systems, or access private data.

## Risk Levels

- `low`: read-only or reversible actions.
- `medium`: writes or external calls with limited blast radius.
- `high`: money movement, production changes, private data export, or irreversible external mutation.
- `critical`: actions that can cause large financial, security, legal, or operational harm.

## Required Controls

High-risk and critical tools must support:

- Dry-run mode.
- Approval gates.
- Per-user and per-workspace limits.
- Allowlists and denylists.
- Cooldowns and rate limits.
- Kill switches.
- Immutable audit events.
- Structured failure reporting.

## Production Bar

Live high-risk tools are blocked until auth, encrypted secrets, tenant isolation, ledgers, auditability, permissions, risk limits, and kill switches exist.

This applies to Polymancer trading tools and to non-trading tools such as deployment, database mutation, billing, email sending, and production admin actions.
