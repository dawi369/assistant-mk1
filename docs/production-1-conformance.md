# Production 1.0 Conformance

Document status: current Operational L3 plus Authority A2 release evidence contract.

The `1.0.0` tag is permitted only when repository gates and guarded hosted
acceptance are green for the same commit. Local conformance proves deterministic
behavior; it does not substitute for WorkOS Vault, retained-storage recovery, or
unattended hosted evidence.

| Guarantee               | Enforcement boundary                         | Executable local evidence          | Same-commit hosted evidence           | 1.0 limitation                      |
| ----------------------- | -------------------------------------------- | ---------------------------------- | ------------------------------------- | ----------------------------------- |
| Forward retained schema | D1 migration ledger                          | `db:cloudflare:migrations:verify`  | fresh apply and recovery rehearsal    | no down migrations                  |
| Workspace retention     | Cloudflare policy and scheduled sweep        | `conformance:data-lifecycle`       | backlog and sweep evidence            | no legal hold                       |
| Complete export         | D1 fence, DO freeze, R2 pin, lifecycle job   | snapshot/ZIP/checksum tests        | encrypted archive download            | bounded writes return 423           |
| Delete and recover      | quarantine and phase-checkpointed purge      | failure/manual-retry tests         | time-shifted recovery/purge rehearsal | credentials are never recovered     |
| Credential custody      | `CredentialVault` and broker                 | `conformance:connections`          | `acceptance:hosted:vault`             | WorkOS Vault only in production     |
| OAuth/API key           | signed Vercel facade and Cloudflare broker   | PKCE/replay/redaction tests        | isolated provider authorization       | trusted provider modules only       |
| Fly credential use      | single-use scoped broker capability          | agent-system service journey       | signed Fly mutation acceptance        | one provider request per capability |
| Durable proposal        | action proposal CAS and ledger               | `conformance:actions`              | isolated proposal ID and ledger       | no package-granted authority        |
| Mutation dispatch       | gates, opt-in, connection, policy, approval  | approval/denial/signed Fly journey | `acceptance:hosted:mutation`          | global mutation defaults off        |
| Ambiguous outcome       | terminal fencing and reconciliation          | timeout then reconcile journey     | recorded unknown/reconciled IDs       | no exactly-once claim               |
| Emergency stop          | workspace/pack/tool/connection kill switches | denial and cancellation assertions | operator drill                        | cannot reverse accepted effects     |
| Operational L3          | trigger leases, replay, alerts               | `conformance:level3`               | 24-hour soak and receiver outage      | single region                       |
| Tenant isolation        | D1/R2/DO/Vault/action predicates             | cross-tenant suites                | separate WorkOS account               | no cross-region failover            |
| Environment isolation   | typed target manifests and guarded commands  | `verify:environment-config`        | protected target preflight            | no automatic promotion              |

Required repository gates:

```bash
pnpm agent-packs:compile --check
pnpm conformance:agent-system
pnpm conformance:level2
pnpm conformance:level3
pnpm conformance:data-lifecycle
pnpm conformance:connections
pnpm conformance:actions
pnpm test:unit
pnpm typecheck
pnpm lint
pnpm test:e2e
pnpm build
pnpm verify:docker
pnpm release:check
```

Guarded hosted gates use an isolated non-customer workspace and write
secret-free evidence under `output/release/<commit>/`:

```bash
pnpm acceptance:hosted:vault
pnpm acceptance:hosted:mutation
pnpm acceptance:hosted:level3
pnpm acceptance:hosted:data-lifecycle
pnpm acceptance:hosted:alert-redelivery
pnpm acceptance:hosted:soak -- --phase start
pnpm acceptance:hosted:soak -- --phase finish --state <same-sha-state.json>
```

The synthetic Complex Operator is hidden unless the isolated acceptance
deployment explicitly sets `WORKBENCH_CONFORMANCE_MODE=true`. Never enable that
mode on the customer-serving deployment; production feature gates and workspace
opt-ins remain separate.

Acceptance lifecycle fault injection and the first-failure alert receiver are
enabled only by the acceptance conformance configuration. Production validation
rejects both modes. Export and purge drills operate only on a newly created,
non-customer workspace; the final purge is verified through remote D1 without
re-authenticating and accidentally recreating the deleted tenant.

Enable retained data first, then connections, then mutation only for the
acceptance workspace. General mutation remains an owner-controlled per-tool
opt-in after retention confirmation and connection authorization.
