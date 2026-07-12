# Level 2 Executable Conformance

Document status: developer-preview release evidence contract.

Level 2 is preview-complete only when `pnpm conformance:level2` reports every
required guarantee as passed for the same commit that passes Docker and hosted
acceptance. The generated machine-readable report is
`output/conformance/level2.json` and is intentionally untracked.

| Level | Guarantee                  | Enforcement boundary                         | Executable evidence                               | Hosted evidence                   | Preview limitation                     |
| ----- | -------------------------- | -------------------------------------------- | ------------------------------------------------- | --------------------------------- | -------------------------------------- |
| 0     | Scoped identity            | Vercel identity facade and Cloudflare authz  | signed-out boundary; clean local bootstrap        | WorkOS signed-in reload           | Local identity is development-only     |
| 0     | Thread continuity          | Cloudflare Session and Thread Agents         | local service-boundary thread and handoff journey | signed-in thread reload           | No retained-data upgrade promise       |
| 1     | Typed tool policy          | Cloudflare tool catalog and policy evaluator | tool-policy unit coverage and approval journey    | Tools/Admin inspection            | Read-only and dry-run only             |
| 1     | Structured results         | signed runner and callback contracts         | Repository Analyst callback journey               | History artifact inspection       | D1 metadata, no artifact blobs         |
| 1     | Audit and redaction        | Cloudflare audit/event writers               | callback and approval assertions                  | Admin/History audit inspection    | Preview retention is disposable        |
| 2     | Typed intents              | Agent Pack catalog and Worker handlers       | pack activation and workflow submission           | Repository Analyst submission     | Unknown declarations are non-runnable  |
| 2     | Durable runs and artifacts | D1 control records                           | signed callback and History journey               | run/artifact IDs recorded         | No backup/retention guarantee          |
| 2     | Approval recovery          | History and approval policy boundary         | deterministic denial fixture                      | signed-in History denial          | Approval execution stays read-only     |
| 2     | Cancellation authority     | conditional D1 transitions                   | cancel-versus-late-callback journey               | hosted cancellation check         | Physical executor abort is best effort |
| 2     | Retry lineage              | run-control retry handler                    | cancelled-run retry journey                       | new and original run IDs recorded | Only registered pack workflows retry   |
| 2     | Agent handoff              | session coordinator and token validation     | stale-token handoff journey                       | current-thread handoff            | No delegated child agent runtime       |
| 2     | Tenant isolation           | Cloudflare scope predicates                  | cross-tenant read/cancel/retry checks             | separate WorkOS account check     | Single-region preview deployment       |

## Commands

```bash
pnpm conformance:level2
pnpm verify:docker
HOSTED_VERCEL_ORIGIN=https://... \
HOSTED_CLOUDFLARE_ORIGIN=https://... \
HOSTED_FLY_ORIGIN=https://... \
pnpm acceptance:hosted:public
```

Signed-in hosted acceptance remains manual because it requires a real WorkOS
session. Record commit SHA, operator, endpoint results, run ID, artifact ID, and
screenshots under `output/release/`. Do not tag the preview until credential
rotation review is complete for any image built before Docker-context hardening.

Level 3 has a separate executable local contract in `level-3-conformance.md`.
Hosted schedule/webhook and unattended-operations evidence remain a release
gate rather than a local implementation gap. Levels 4 and 5 remain target-only. Swordfish is
packaged but parked and is not part of this conformance gate.
`agent-packs:smoke` remains static manifest/catalog validation rather than
runtime evidence.
