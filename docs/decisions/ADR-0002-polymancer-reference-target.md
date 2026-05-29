# ADR-0002: Polymancer As Reference Target

Status: accepted

## Context

Assistant-MK1 is meant to become a reusable agent workbench, not a one-off chatbot. The framework needs a demanding reference app that forces the right architecture decisions early.

Polymancer is that reference app: a future Polymarket-focused assistant that can operate 24/7, discuss conviction and positions, use user-specific knowledge, run scheduled monitors, react to external triggers, and eventually execute through high-risk tools.

## Decision

Use Polymancer as the reference benchmark while preserving generic framework boundaries.

Assistant-MK1 must support the primitives Polymancer needs: identity, tenancy, encrypted secrets, tool registry, CLI/OSS tool adapters, ledgers, schedules, triggers, memory/personality, approvals, artifacts, audit logs, risk policies, and kill switches.

Polymarket-specific code should live in adapter/configuration layers, not in core workbench components.

## Consequences

- Trading can guide architecture, but Assistant-MK1 must stay useful for non-trading projects.
- Tools must be easy to add, permission, observe, and disable.
- CLI tools, OSS packages, scripts, and future git submodules must be wrappable as server-side tools.
- Multi-user isolation is required early, even if the first user is only the project owner.
- Live autonomous trading is not considered production-ready before auth, encrypted secret custody, durable ledgers, auditability, risk limits, and kill switches exist.
