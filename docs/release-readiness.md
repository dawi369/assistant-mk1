# 1.0.0-preview.1 Developer Preview Readiness

Document status: current release contract.

The Assistant-mk1 preview is an authenticated, tenant-scoped, read-only agent
workbench. Remote D1 state and D1-backed artifact metadata are disposable. This
release makes no commitment to upgrade-safe customer-data retention, external
mutation, encrypted credential brokerage, or artifact blob storage.

## Included

- WorkOS sign-in, sign-out, reload recovery, and organization switching.
- Cloudflare-owned account, workspace, membership, role, and agent resolution.
- Customer-facing workspace switching and owner/admin member administration.
- Cloudflare Agents chat, local-new first paint, recent chats, and agent switching.
- Typed read-only pack workflows and policy-gated read-only tools.
- Searchable execution history, metadata artifacts, approvals, cancellation,
  retry for supported pack workflows, and reconnect recovery.
- Unit, contract, service-boundary, and browser release checks.
- Vercel, Cloudflare, Fly, WorkOS, Sentry, and local-development runbooks.

## Release Evidence

| Gate                         | Evidence                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| Repository                   | `pnpm release:check`                                                        |
| Static real-session contract | `pnpm eval:real-session-posture`                                            |
| Deterministic services       | `pnpm test:service-boundaries`                                              |
| Level 2 conformance          | `pnpm conformance:level2` and `docs/level-2-conformance.md`                 |
| Docker boundary              | `pnpm verify:docker`                                                        |
| Hosted public boundaries     | `pnpm acceptance:hosted:public`                                             |
| Dependency security          | `pnpm verify:security`                                                      |
| Cloudflare authorization     | `pnpm smoke:cloudflare-authz` and `pnpm smoke:cloudflare-membership-policy` |
| Tenant isolation             | `pnpm smoke:tenant-isolation` and the boundary smokes                       |
| Run recovery                 | run-control unit tests, history smoke, and hosted browser acceptance        |
| Browser UX                   | `pnpm test:e2e` plus signed-in Dia acceptance                               |
| Documentation                | `docs/README.md` current-state map and deploy runbooks                      |

## Deferred Gates

The following are intentionally outside the 1.0 read-only baseline:

- forward-only D1 migrations, backup/restore, and retained customer history
- the broader unattended-production operations gate
- encrypted credential custody and refresh brokerage
- mutation-capable tools and external side effects
- R2 artifact blobs, export, and deletion workflows
- plugin marketplace and multi-region deployment

Remote D1 remains disposable development validation state until
`docs/migrations-and-retention.md` is implemented. A release must not describe
that state as retained customer history.

## Preview Release Checklist

- [ ] A clean clone installs with `pnpm install --frozen-lockfile`, initializes
      disposable D1, passes `pnpm workbench:doctor`, and reaches usable chat by
      following only the README.
- [ ] `pnpm release:check` and all GitHub Actions jobs are green.
- [ ] `pnpm conformance:level2` is green and its report names the release commit.
- [ ] `pnpm verify:security` reports no high-severity advisory.
- [ ] Docker context inspection proves synthetic sentinels under ignored local
      state and secret paths do not enter the image; the runtime runs non-root.
- [ ] Hosted Vercel, Cloudflare, and Fly unauthenticated health boundaries match
      their runbooks and disclose no tenant or configuration data.
- [ ] Signed-in manual acceptance covers pack activation, Repository Analyst
      completion, structured History inspection, cancel/late-result rejection,
      retry lineage, approval denial/recovery, and agent handoff.
- [ ] Review whether any prior Fly build included local credentials; rotate every
      affected credential class before tagging if exposure cannot be disproved.
- [ ] Capture current workbench, History, and Agent Pack screenshots.
- [ ] Confirm `CHANGELOG.md` and the disposable-data preview contract are current.
- [ ] Create the `v1.0.0-preview.1` prerelease tag only after all preceding gates pass.

## Hosted Acceptance

The deterministic local browser gate runs first. It uses an isolated D1 state
directory, holds Worker staging long enough to prove the optimistic new-chat
surface, and verifies workspace membership plus retry controls. The production
pass then uses the existing WorkOS session and validates:

1. Signed-out reload shows only the deliberate sign-in surface.
2. Signed-in reload never flashes cached workspace data before auth resolves.
3. New chat paints immediately and the first prompt sends after background connection.
4. Existing threads switch, rename, archive, restore, and delete correctly.
5. Account, workspace, agent, workflow, history, and Admin surfaces enforce role scope.
6. Failed/disconnected states expose a useful next action.
7. Interrupted approvals resume or deny from History.
8. Supported failed pack workflows retry as new linked runs.
