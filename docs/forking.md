# Forking and Upstream Updates

Document status: current downstream compatibility and update policy.

`fork-base-v1.0.1` is the recommended immutable full-repository foundation for
new downstream agent products. `fork-base-v1` remains immutable and supported
as historical compatibility evidence. Neither tag promises that future
Assistant-mk1 source changes merge without conflicts; each is a compatibility
checkpoint enforced by the SDK contract, compiler, runtime resolution,
installed-package conformance, and CI.

## Boundaries

Application-owned code includes the Vercel facade, Cloudflare control plane,
Fly gateway, D1 lifecycle, connection/action authority, session coordination,
and generic workbench UI. A downstream agent should normally change only its
Runtime Module package and the single entry in `workbench.config.ts`.

The extension contract is:

- Pack API v2 immutable manifest snapshots;
- Runtime Module v1 `manifest`, `control-plane`, `runner`, and `web` exports;
- `AgentExecutionContext` rather than raw platform state or credentials;
- compile-time and runtime workbench/pack/runtime compatibility checks;
- generated registries as reviewed build artifacts.

Additive Runtime Module v1 declarations are compatible. Breaking serialized or
source contracts require a new API major. An incompatible historical snapshot
keeps chat access but cannot invoke tools, workflows, triggers, retries, or
actions; runtime resolution fails closed with `workbench_incompatible` or
`runtime_incompatible`.

## Create the downstream repository

Fork or clone the complete repository at `fork-base-v1.0.1`, then retain the
original repository as a read-only upstream:

```bash
git remote rename origin upstream
git remote add origin <downstream-repository-url>
git fetch --tags upstream
git switch -c main fork-base-v1.0.1
git push -u origin main
```

Record the base tag and commit in downstream release notes. Do not move or
recreate foundation tags.

## First real fork checklist

The first domain product is also the first external-repository acceptance proof:

1. Fork from `fork-base-v1.0.1` and run `pnpm fork:check` before domain changes.
2. Record the base SHA, SDK contract hash, Node and pnpm versions, and CI result.
3. Add the downstream package only through the four Runtime Module exports and
   the package entry in `workbench.config.ts`; do not register it in core code.
4. Rerun `pnpm fork:check` and preserve its ignored conformance evidence.
5. Rehearse one upstream merge on a disposable update branch before accepting
   any upstream compatibility update.

## Review an upstream update

Never merge upstream automatically. Use one disposable update branch per
candidate merge:

```bash
git fetch upstream --tags
git switch main
git switch -c update/assistant-mk1-<date>
git merge --no-commit upstream/main
```

Review SDK contract changes before resolving application conflicts. Refresh a
contract manifest only when the downstream intentionally accepts the public
change and records it in its changelog. Generated registry drift is resolved by
running the compiler, never by hand-editing generated files.

The acceptance command is:

```bash
pnpm fork:check
```

It includes registry and pack validation, SDK hash and zero-context consumer
checks, installed-package extension conformance, runtime architecture tests,
unit/type/lint/security/build checks, Docker containment, Level 2-3, lifecycle,
connection, action, agent-system, and browser journeys. A merge is eligible only
when local evidence and GitHub checks are green for the same commit.

## Rollback

If an accepted upstream update regresses the downstream product, restore the
previous downstream release from its immutable foundation-derived tag. Do not
rewrite the current tag or force an incompatible SDK manifest. Create a new
fix/update branch and rerun `pnpm fork:check` before advancing production.

Database and hosted infrastructure changes remain separate rollout decisions.
Passing the fork gate does not authorize deployment, migration, credential
rotation, package publication, or feature-gate activation.
