# Plan 006: Separate acceptance and production and collect same-commit evidence

> **Executor instructions**: This plan is deliberately last. Build configuration
> and dry-run checks first. Do not provision, migrate, deploy, enable mutations,
> or alter DNS without explicit operator approval at each external-state phase.
> Update `plans/README.md` when done.
>
> **Drift check**: `git diff --stat 5eb783a..HEAD -- cloudflare/control-plane/wrangler.jsonc fly.langgraph.toml vercel.json package.json scripts docs/deployment-vercel.md docs/production-1-conformance.md docs/release-readiness.md .github/workflows/verify.yml`

## Status

- **State**: IN PROGRESS - local boundary and `pnpm release:check` are green;
  acceptance provisioning is the next separately approved external-state phase
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH - hosted configuration, retained data, and mutation authority
- **Depends on**: Plans 001-005
- **Category**: migration
- **Planned at**: `5eb783a`, 2026-08-01

## Why this matters

The repo currently hard-codes one `*-dev` Worker, D1 database, R2 bucket, and Fly
app while release conformance requires Complex Operator to be enabled only in an
isolated non-customer acceptance deployment. A production release needs explicit
targets, fail-closed deployment commands, and evidence tied to one full SHA.

## Target topology

Maintain three explicit targets:

- `local`: Miniflare/local D1/R2, in-memory Vault, conformance allowed.
- `acceptance`: isolated WorkOS organization/workspace, distinct Worker/D1/R2/DO
  namespace and Fly app, synthetic provider, conformance enabled, no customers.
- `production`: distinct Worker/D1/R2/DO namespace and Fly app, WorkOS Vault,
  conformance disabled, mutations globally off until an owner opts in.

Vercel production must point only at production. A protected Vercel preview or
separate project points at acceptance. No resource ID or secret is shared except
explicit deployment-level public metadata.

## Scope

**In scope**:

- environment descriptors and explicit deploy/migrate/acceptance scripts
- separate Cloudflare, D1, R2, DO, Fly, Vercel, WorkOS, and evidence contracts
- CI configuration validation and guarded hosted release workflow
- same-commit evidence collector, runbooks, dashboards/alert checks

**Out of scope**: multi-region failover, customer migration between environments,
automatic production mutation enablement, credential rotation, DNS cutover
without approval, or replacing Vercel/Cloudflare/Fly/WorkOS.

## Steps

1. Add a typed environment manifest with `local|acceptance|production` names and
   required non-secret resource identifiers/URLs. Put secrets only in provider
   secret stores. Add `pnpm environment:check --target <target>` that verifies
   complete, mutually distinct resources and rejects production when
   `WORKBENCH_CONFORMANCE_MODE=true`, memory Vault is selected, dev tokens are
   present, or mutation defaults on.

2. Split deployment configuration without ambiguous defaults. Each Cloudflare
   target has distinct Worker name, D1 ID, R2 bucket, DO namespace/migrations,
   callback URL, and upstream. Each Fly target has a distinct app and callback
   allowlist. Deploy/migration commands require `--target`; remove commands that
   silently mutate `assistant_mk1_dev` when the caller intended production.

3. Add configuration-only CI tests proving no acceptance identifier appears in
   production bundles, no production identifier appears in conformance fixtures,
   runner/callback secrets match within a target but differ across targets, and
   Cloudflare never imports runner executables.

4. Add guarded provisioning runbooks and dry-run commands. Before external
   changes, record backups, current versions, health, migration ledger, resource
   IDs, full SHA, and operator. Require explicit approval separately for creating
   acceptance resources, applying migrations, deploying acceptance, and later
   deploying production.

5. Deploy acceptance only after all local gates pass. Apply forward migrations
   to fresh acceptance D1, provision empty R2/DO state, configure WorkOS Vault,
   enable retained data then connections then mutations only for the synthetic
   acceptance workspace, and verify public unauthenticated boundaries.

6. Run the same-commit evidence program:
   - clean-clone doctor and full `release:check`;
   - D1 migration/recovery, R2 restore, snapshot-consistent export, quarantine,
     recovery, failed-purge retry, and time-shifted final purge;
   - Vault create/read-version/replace/revoke/delete and OAuth/API-key flows;
   - synthetic mutation approval denial/resume, idempotent dispatch, every kill
     switch, cancellation, `outcome_unknown`, reconciliation, and tenant 404;
   - signed-in browser acceptance and live-state convergence;
   - 24-hour schedule/webhook soak, duplicate delivery, receiver outage and
     redelivery, Worker/Fly restart, lease expiry, replay, and alert lifecycle.

7. Write one secret-free `output/release/<full-sha>/manifest.json` with service
   versions, command results, run/artifact/proposal/job identifiers, checksums,
   timestamps, operator, screenshots, dashboards, and artifact paths. The
   collector fails if evidence spans commits, targets, or feature-gate order.

8. Only after acceptance is green, deploy the identical source SHA/config schema
   to production with retained data and connections enabled as approved and
   mutations globally off. Run public and signed-in read-only acceptance. Enable
   mutation only in a new isolated production acceptance workspace if explicitly
   approved; never enable it generally as part of deployment.

## Done criteria

- Local, acceptance, and production resources are distinct and mechanically
  validated.
- Production cannot boot in conformance mode or with the in-memory Vault.
- Every hosted release row is green for one full SHA and one target.
- The 24-hour soak and outage/redelivery evidence are elapsed observations, not
  local substitutes.
- Production deploys from the accepted SHA with mutations default-off.
- Hosted health, signed-in product behavior, dashboards, rollback/forward-fix
  runbooks, and release evidence agree.

## STOP conditions

- Stop before any external mutation lacking explicit operator approval.
- Stop if a target would reuse D1, R2, DO, Fly, WorkOS application, or secrets
  from another target.
- Stop if a migration requires rewriting an applied migration or destructive D1
  rebuild.
- Stop if evidence contains credentials, customer content, or mixed SHAs.
- Stop if production requires enabling conformance mode or global mutation.

## Maintenance notes

Environment manifests become a release security boundary. Reviewers must treat a
resource-ID change like infrastructure code. Future deployment automation should
promote accepted artifacts/configuration, not rebuild from an unverified branch.
