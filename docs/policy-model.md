# Policy Model

Policy is the deterministic boundary between user intent, model proposals, and
tool or workflow execution. The model can explain and propose; policy decides
whether work may run.

## Core Principle

Policy is enforced outside the model.

The model never decides:

- tenant scope
- secret access
- whether live mutation is allowed
- approval bypass
- tool visibility
- kill switch state

## Execution Modes

The first stable control is execution mode:

- `ask`: reason, explain, inspect safe state, and propose.
- `dry_run`: simulate effects and return proposed actions.
- `execute`: mutate external state only when policy allows it.

All workflow intents and tool calls carry an execution policy.

## Policy Decision

The provisional runtime contract is `PolicyDecision`. It records the effective
decision for a proposed workflow or tool action without becoming the full policy
configuration schema.

A policy check should return:

- allowed or denied
- reason
- effective execution mode
- approval requirement
- limits applied
- redaction requirements
- audit summary

Denied policy checks should not disappear. They should create audit events and,
when user-visible, structured UI state.

## Approval Gates

Use approvals for:

- live external mutation
- expensive operations
- credential access
- irreversible actions
- production deploys
- market/order execution
- broad data export
- cross-workspace sharing

Approval flow:

```txt
policy requires approval
  -> run status interrupted
  -> approval.requested event
  -> user approves or denies
  -> resume or cancel/fail run
  -> audit event records decision
```

## Limits And Kill Switches

Policy configuration may include:

- per-user limits
- per-workspace limits
- per-tool limits
- rate limits
- cooldowns
- allowlists
- denylists
- max cost
- max runtime
- max child-run depth
- environment restrictions
- global kill switch
- workspace kill switch
- tool family kill switch

Schemas for those settings remain deferred until implementation proves the
fields needed. The behavior is not deferred.

## Tool Exposure Policy

Tool exposure is a policy boundary.

A tool should be hidden from the model when:

- tenant lacks permission
- execution mode does not allow it
- current workflow stage does not need it
- child-run context restricts it
- required secret is missing or disabled
- kill switch disables the tool/family
- runtime platform cannot execute it safely

Hidden tools may still appear in admin/debug UI with a reason, but should not be
included in the model-visible tool list.

## Production Mutation Gate

Live external mutation is blocked until all are true:

- authenticated user/workspace identity
- encrypted, scoped secret custody
- tool permission records
- dry-run path for the action class
- approval gates where required
- audit events
- ledger entries
- artifact/log redaction
- policy limits
- kill switches
- tenant isolation tests

This applies to deployments, market execution, databases, billing, email,
production admin actions, and any tool that can spend money or modify external
systems.

## Failure Behavior

Policy failures should be explicit:

- `policy_block`: action denied by policy.
- `approval_required`: run interrupted until user decision.
- `missing_secret`: credential absent or disabled.
- `limit_exceeded`: configured limit or cooldown blocks action.
- `kill_switch`: global, workspace, or tool switch blocks action.
- `tenant_violation`: requested action crosses scope boundary.

Policy failure details must not leak secrets or raw private data.

## Acceptance Criteria

- Every tool call has an execution mode.
- Mutation-capable tools cannot execute in `ask` or unapproved `dry_run`.
- Policy blocks are visible in audit and UI history.
- Kill switch behavior is testable without real external mutation.
