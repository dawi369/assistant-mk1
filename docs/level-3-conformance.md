# Level 3 Executable Conformance

Document status: read-only background-work evidence contract.

Level 3 is locally conformant only when `pnpm conformance:level2` and
`pnpm conformance:level3` both pass for the same commit. The Level 3 report is
written to `output/conformance/level3.json` and is intentionally untracked.
Local conformance does not by itself authorize a production-unattended release:
the same commit still needs hosted schedule/webhook, recovery, alerting, and soak
evidence.

| Guarantee                | Enforcement boundary                         | Implementation seam                           | Executable evidence                     | Hosted evidence                   | Preview limitation                 |
| ------------------------ | -------------------------------------------- | --------------------------------------------- | --------------------------------------- | --------------------------------- | ---------------------------------- |
| Forward upgrades         | D1 migration ledger                          | `cloudflare/control-plane/migrations/*`       | migration verifier                      | remote dry-run and applied ledger | rollback remains restore/redeploy  |
| Pack API v2              | checked-in catalog validation                | `agent-packs/types.ts`, built-in packs        | Pack contract tests                     | installed snapshot inspection     | code-first packs only              |
| Managed state            | tenant-scoped version CAS                    | `managed-state.ts`                            | unit and Repository Analyst journey     | retained state inspection         | metadata in D1 only                |
| Trusted triggers         | retained pack snapshot binding               | `triggers.ts`                                 | CRUD/dispatch tests and browser journey | operator-created trigger          | no user-installed code             |
| Schedule/timezone        | Cloudflare scheduled handler                 | `trigger-schedule.ts`, `trigger-scheduler.ts` | timezone unit tests and scheduled tick  | real Cron Trigger execution       | one-minute scheduler cadence       |
| Webhook auth/idempotency | signed Vercel facade plus per-trigger secret | `trigger-webhook.ts`                          | duplicate-delivery journey              | public endpoint delivery          | secret is shown once; no vault yet |
| Leases/heartbeats        | conditional D1 writes                        | `trigger-execution.ts`, workflow lifecycle    | lease and callback tests                | abandoned-job observation         | physical abort is best effort      |
| Concurrency              | trigger and active-run predicates            | `trigger-execution.ts`                        | concurrency unit/service assertions     | burst delivery check              | per-trigger limit only             |
| Cancellation authority   | terminal run and dispatch CAS                | run control and trigger transitions           | cancel-before-late-callback journey     | hosted delayed callback check     | executor may finish physically     |
| Replay lineage           | fenced dispatch attempt generation           | `triggers.ts`, workflow lifecycle             | cancelled replay journey                | operator replay with recorded IDs | replay reuses the dispatch record  |
| Lease recovery           | expiry scan and conditional recovery         | `trigger-recovery.ts`                         | recovery unit tests                     | forced worker interruption        | no multi-region coordinator        |
| Workflow tool policy     | internal policy check before every tool      | `workflow-tool-policy.ts`                     | built-in workflow policy tests          | denied tool audit inspection      | read-only tools only               |
| Tenant isolation         | Cloudflare scope predicates                  | all trigger/state routes                      | cross-tenant 404 journey                | separate WorkOS account check     | preview tenancy model              |
| Operator visibility      | Admin Automations and History                | `workbench-automations-panel.tsx`             | browser visibility assertions           | screenshots and IDs               | compact operator surface           |
| Failure alerting         | durable D1 alert plus signed HTTPS delivery  | `operator-alerts.ts`, trigger failure paths   | alert delivery and fencing unit tests   | received alert ID and resolution  | one operator webhook destination   |
| Retained-data lifecycle  | D1 policy plus mediated R2 custody           | `artifact-lifecycle.ts`, migration `0005`     | local R2 browser plus backup tests      | R2 restore and hosted export      | deletion plan is non-executable    |
| Pack authoring           | Pack API v2 generator and validator          | `agent-pack-scaffold.ts`, pack dev loop       | scaffold and validation tests           | downstream pack trial             | trusted checked-in packs only      |
| Connection declaration   | secret-free Pack descriptor validation       | Pack API v2 plus `connection-auth.ts`         | descriptor and projection tests         | broker integration required       | no credential custody or refresh   |

## Commands

```bash
pnpm conformance:level2
pnpm conformance:level3
pnpm release:check
```

Before enabling unattended hosted work, record the commit SHA, operator,
trigger and dispatch IDs, run and artifact IDs, webhook duplicate result,
recovery result, screenshots, logs, and alert destination under
`output/release/`. Swordfish remains parked and excluded. Levels 4 and 5 remain
target-only.

The exact hosted enablement, failure recovery, alert redelivery, soak, and kill
procedure is in `unattended-operations.md`.
