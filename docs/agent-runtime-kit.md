# Agent Runtime Kit

Document status: current Runtime Module v1 authoring and enforcement contract.

The Runtime Kit turns a trusted build-time package into an executable Agent
Pack without editing application, Worker, or runner registries. The package is
listed once in `workbench.config.ts`; `pnpm agent-packs:compile` validates its
exports and deterministically generates environment-specific registries under
`generated/agent-runtime/`.

Remote installation and unreviewed executable uploads are not supported.
Packages execute with the authority of reviewed application code, while
tenant scope, policy, approvals, lifecycle writes, audit, and publication
authority remain platform-owned.

## Package Contract

Every package exports:

| Export            | Loaded by                   | May contain executable code     |
| ----------------- | --------------------------- | ------------------------------- |
| `./manifest`      | compiler and snapshot layer | no; Pack API v2 is JSON-safe    |
| `./control-plane` | Cloudflare Worker           | Cloudflare-safe tools/workflows |
| `./runner`        | signed Fly runner           | Node/container tools            |
| `./web`           | Next.js                     | trusted React renderers         |

Each runtime entry declares `packId`, one `runtimeVersion`, and
`compatiblePackVersions`. The compiler rejects inconsistent runtime versions,
missing tool/workflow/health/eval/renderer providers, collisions, invalid
schemas, engine mismatches, and incompatible current manifests.

The publish-ready SDK is in `packages/agent-sdk`:

```ts
import { defineAgentPack } from "@assistant-mk1/agent-sdk/manifest";
import { defineControlPlaneModule } from "@assistant-mk1/agent-sdk/control-plane";
import { defineRunnerModule } from "@assistant-mk1/agent-sdk/runner";
import { defineWebModule } from "@assistant-mk1/agent-sdk/web";
```

Its JSON contracts are `schemas/agent-pack-v2.schema.json` and
`schemas/runtime-module-v1.schema.json`. `pnpm agent-sdk:verify` packs the SDK
into ignored output and typechecks an isolated consumer. The SDK is not
published by this repository.

## Execution Boundary

Workflow requests use the generic routes:

```txt
POST /api/workbench/workflows/<workflow-type>
  -> signed Vercel facade
  -> POST /workbench/workflows/<workflow-type>
  -> compiled Cloudflare runtime binding
```

Before package code runs, Cloudflare resolves the active immutable Agent Pack
snapshot, checks its runtime compatibility, validates input, evaluates every
tool policy, applies concurrency and resource limits, and creates the run
lifecycle atomically. Package handlers receive only `AgentExecutionContext`:

- frozen user/workspace/agent and run scope
- abort signal and declared resource ceiling
- policy-checked tool invocation
- compare-and-set managed-state writes
- scoped event append
- `ConnectionPort`
- `ActionPort`

Handlers never receive D1, Worker `Env`, auth headers, signing secrets, provider
credentials, or unrestricted network clients. Tool and workflow outputs are
schema-checked. Artifact size and tool-call count are enforced before
failure-atomic publication. Cancellation permanently revokes publication
authority; executor termination remains best effort.

Current platform adapters for the three bundled packs live behind the core
workflow provider while their manifests, forms, policy defaults, routes,
compatibility, and environment bindings come from compiled modules. New
packages use the generic kernel directly.

## Connections And Actions

`ConnectionPort` returns `authorization_required` for any credentialed
connection until a platform broker supplies a scoped capability. No token is
passed to the pack.

`ActionPort.propose()` creates a dry-run proposal contract.
`ActionPort.execute()` always throws `mutation_disabled`. These are Level 5
composition seams, not mutation authority.

## Forms, Artifacts, State, Health, And Evals

- Workflow forms are arbitrary declarative fields backed by the binding input
  JSON Schema.
- History always has JSON, Markdown, and table fallbacks.
- The web registry can supply a trusted React renderer. Props are depth,
  count, and size bounded and keys resembling credentials are removed. A
  renderer error falls back to the generic renderer.
- Managed-state descriptors continue to project through generic tenant-scoped
  list/detail surfaces and CAS writes.
- Required runtime health bindings run as part of deep Worker health.
- Required deterministic evals run through `pnpm agent-packs:test` and the
  aggregate conformance gate.

## Complex Operator Golden Path

`examples/complex-operator` is an external-style, conformance-only package. It
proves a Cloudflare-native tool, signed Fly tool, multi-step workflow,
schedule/webhook declarations, managed-state CAS, structured artifact and
trusted renderer, required health/evals, connection authorization posture, and
a dry-run action proposal with mutation disabled. It performs no provider
traffic, credential handling, or external mutation.

`pnpm conformance:agent-system` executes that package through the isolated
Worker, signed local Fly-shaped runner, and D1 boundary, then verifies the
persisted runtime metadata, three tool calls, structured artifact, and managed
state. Static package tests remain separate so a registry declaration alone
cannot satisfy the extension gate.

To add a comparable package:

```bash
pnpm agent-packs:create --id my-operator --name "My Operator"
# edit only agent-packs/my-operator/* and its generated workbench.config.ts entry
pnpm agent-packs:compile
pnpm agent-packs:inspect --pack my-operator
pnpm agent-packs:test --pack my-operator
pnpm conformance:agent-system
```

Generated registries are tracked. CI runs `agent-packs:compile --check`, so
configuration or package changes cannot land with stale environment registries.

## Compatibility And Limits

An incompatible historical Agent snapshot remains available for chat but its
workflows return `runtime_incompatible` until an explicit agent upgrade creates
a compatible snapshot. A runtime package deploys one version at a time.

Not implemented: remote package installation, arbitrary executable uploads,
credential brokerage, actual external mutation, package-owned D1 access,
retained-data migration hooks, or marketplace distribution. Swordfish remains
packaged and intentionally parked.
