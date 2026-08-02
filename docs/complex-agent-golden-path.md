# Complex Agent Golden Path

Document status: current build-time package workflow, using Polymancer as the
reference pressure test. This guide does not add trading authority.

The supported extension boundary is one trusted Runtime Module v1 package plus
one `workbench.config.ts` entry. A normal complex agent must not add core HTTP
routes, import D1 or Worker `Env`, handle raw credentials, or bypass platform
policy and lifecycle services.

## 1. Initialize The Workbench

```bash
pnpm install --frozen-lockfile
pnpm workbench init
# Set OPENROUTER_API_KEY in .env.local and cloudflare/control-plane/.dev.vars.
pnpm workbench doctor --offline
pnpm workbench dev
```

`workbench init` creates only missing local files, fills documented blank or
placeholder local values, generates matching transport secrets, enables the
local Admin identity, and applies forward D1 migrations. It never overwrites a
configured credential or custom endpoint; it does upgrade the retired inline
local-runner default to the complete signed path.

The normal developer command starts the signed local runner as well as Next.js,
LangGraph, and Cloudflare. Repository Analyst is therefore the first end-to-end
sanity check: it must complete its Fly-bound snapshot through the ordinary UI.

## 2. Scaffold A Package

Keep `baby-polymancer` as a read-only characterization fixture. Create the
product package separately:

```bash
pnpm agent-packs:create --id polymancer --name "Polymancer"
pnpm workbench pack check --pack polymancer
```

The scaffold creates and registers:

| File                    | Responsibility                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `prompt.xml`            | Model identity, behavior, refusal, and output contract                 |
| `manifest.ts`           | JSON-safe Pack API v2 export                                           |
| `index.ts`              | Identity, tools, workflows, risk, connections, state, triggers, UI     |
| `control-plane.ts`      | Cloudflare-safe tools, workflows, proposals, managed state, evals      |
| `runner.ts`             | Signed Node/Fly executors; no tenant selection or raw credential input |
| `web.ts`                | Trusted artifact and managed-state renderers                           |
| `control-plane.test.ts` | Package-local identity, health, and eval characterization              |
| `README.md`             | Package-local development loop and authority checklist                 |
| `package.json`          | Runtime Module v1 subpath exports                                      |

The compiler adds only the package entry to `workbench.config.ts` and generates
the environment registries. Generated files are tracked and checked in CI. The
focused `pack check` command compiles, validates, inspects, and executes the
package health, eval, and deterministic workflow contract.

## 3. Start Read-Only

Use `agent-packs/baby-polymancer` as the working example. Its current adapters
show the intended sequence:

```text
polymarket.market.search
  -> polymarket.market.snapshot
  -> polymarket.orderbook.snapshot
  -> polymancer.market_research
  -> market_research_report artifact
```

For every tool declare:

- bounded JSON input and output schemas;
- `dry_run` or `execute` modes;
- `cloudflare_inline` or `fly` transport;
- adapter version, timeout, and artifact ceiling;
- model/admin visibility and policy reference;
- mutation risk and approval posture.

Public-data tools should remain Cloudflare-inline when they are short and
portable. Use Fly for Node-only SDKs, repository/process work, or execution that
needs an isolated filesystem. Network transport is an implementation detail;
the workflow engine still records the actual orchestrator.

## 4. Add Product State

Represent domain state through platform-owned managed state instead of adding
Polymancer tables to the framework:

| Namespace/state type  | Example keys and data                                      |
| --------------------- | ---------------------------------------------------------- |
| `polymancer.market`   | market id, outcome, liquidity, spread, close time          |
| `polymancer.wallet`   | public address, watch status, observed activity            |
| `polymancer.thesis`   | confidence, evidence, counter-evidence, expiry             |
| `polymancer.position` | market, outcome, size, cost, current exposure              |
| `polymancer.risk`     | limits, allowlists, denylists, cooldowns, approval posture |

Use `context.managedState.upsert()` with an expected version for compare-and-set
writes. A cancelled or terminal run cannot publish managed-state changes.

## 5. Add Background Work

Declare schedules and signed-webhook triggers in the pack manifest, targeting
the same workflow bindings used by manual runs. Good first monitors are:

- bounded market polling;
- wallet activity review;
- thesis freshness review;
- daily research brief;
- price/liquidity alert ingestion through a signed webhook.

Begin with bounded polling. A persistent external WebSocket consumer should
normalize provider events into signed pack webhooks; it should not create a
second run lifecycle or write control-plane state directly.

## 6. Add Durable Proposals Before Execution

Model external action as two separate tools:

```text
polymancer.trade.propose  (dry_run)
polymancer.trade.execute  (dry_run + execute, action binding)
```

The proposal contains a redacted preview and stable idempotency key. The execute
binding declares proposal/result schemas, connection, approval posture, timeout,
and reconciliation. Follow `examples/complex-operator/control-plane.ts` for the
current executable pattern.

The platform, not the package, decides whether execution is permitted. It checks
retention confirmation, global/workspace enablement, connection health, every
kill switch, policy, approval, limits, and proposal state before dispatch.

## 7. Keep Credentials Outside Package Code

Use `ConnectionPort.resolve()` for ordinary provider HTTP requests. Package code
receives a scoped request capability, never Vault payloads. Fly invocations
receive a short-lived broker capability rather than provider credentials.

Providers requiring wallet or payload signing do not fit the current bearer or
API-key injection adapter. Define their trusted operation and signing boundary
against `provider-operation-contract.md` before implementing live execution.
Do not accept a wallet private key as workflow input or pass it to a generic
runner.

## 8. Contribute Product Rendering

Register artifact and managed-state descriptors in `web.ts`. Generic JSON,
Markdown, and table rendering remains the failure fallback. Domain renderers
should display sanitized, bounded values and must not receive connection
credentials, raw provider responses, or model prompts.

Useful Polymancer outcomes include:

- market comparison and order-book summaries;
- thesis and conviction timelines;
- trade proposal previews;
- approval and policy explanations;
- execution and reconciliation receipts.

## 9. Verify The Package

```bash
pnpm agent-packs:compile --check
pnpm agent-packs:validate
pnpm agent-packs:inspect --pack polymancer
pnpm agent-packs:test --pack polymancer
pnpm workbench pack check --pack polymancer
pnpm conformance:agent-system
pnpm conformance:level2
pnpm conformance:level3
pnpm test:unit
pnpm typecheck
pnpm lint
pnpm test:e2e
pnpm build
git diff --check
```

Add connection and action conformance once the package declares those
capabilities. Provider traffic, trading, and secrets remain outside deterministic
repository gates.

## Core-Edit Stop Conditions

Stop and review the extension contract instead of improvising if the package
appears to require:

- a dedicated Next.js or Worker workflow route;
- raw D1, R2, Durable Object, or Worker `Env` access;
- credentials in pack, Fly envelope, model context, artifact, or callback data;
- a tool-specific branch in the generic gateway or model dispatcher;
- a second lifecycle, approval, audit, connection, or action store;
- package-supplied schema migrations;
- automatic retry of an externally ambiguous action.

Those are platform-boundary changes, not ordinary Agent Pack work.
