# Provider Operation Contract

Document status: target additive Runtime Module v1 seam. No credential-isolated
signing executor is implemented by this document.

## Problem

The current connection broker supports provider requests whose credentials can
be injected as bearer or `x-api-key` authentication. Some providers require a
trusted adapter to construct multiple authentication headers, sign a payload,
or use a wallet key. Exposing that credential to Agent Pack or generic Fly code
would break the workbench custody boundary.

Polymarket is the reference pressure: public market data fits normal read-only
tools, while authenticated order creation requires provider-specific signing.

## Boundary

Add a provider-owned operation registry behind `ConnectionPort`, conceptually:

```ts
type ProviderOperationRequest = {
  connectionId: string;
  operation: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
};

type ProviderOperationResult = {
  status: "succeeded" | "failed" | "outcome_unknown";
  summary: string;
  externalReference?: string;
  output?: Record<string, unknown>;
};
```

The operation implementation is platform-reviewed and provider-specific. It
runs inside a credential-isolated broker boundary and may:

1. resolve the workspace connection and current Vault version;
2. verify workspace, pack, tool, run, proposal, and tool-call scope;
3. validate the named operation against a checked-in provider registry;
4. read the credential without returning it;
5. build authentication headers or sign the bounded payload;
6. dispatch only to the registered host and method;
7. redact and schema-check the result;
8. append provider reference and outcome evidence through the action lifecycle.

The generic Runtime Module receives only the redacted result. The Fly envelope,
callback body, artifact, audit payload, runtime trace, and model context never
contain signing material.

## Provider Declaration

A provider module declares:

- provider and operation ids;
- input and output JSON Schemas;
- allowed connection credential classes;
- allowed hosts and HTTP methods;
- timeout and response-size ceilings;
- whether idempotency is required;
- whether an ambiguous outcome is possible;
- reconciliation operation, when ambiguity is possible;
- redaction fields and safe operational metadata;
- health and deterministic test adapters.

Agent Packs can reference operations but cannot register new credential handlers
at runtime or grant themselves authority.

## Polymancer Mapping

A future reviewed provider module could expose:

```text
polymarket.credentials.derive
polymarket.balance.read
polymarket.orders.read
polymarket.order.preview
polymarket.order.submit
polymarket.order.cancel
polymarket.order.reconcile
```

The product must choose its wallet model before implementing these operations:
user-confirmed signing, a narrowly funded delegated wallet, or custodial key
storage. The workbench must not infer that decision from an Agent Pack.

## Non-Goals

- No general remote-code or provider-plugin installation.
- No raw secret-returning API.
- No signing inside model or browser code.
- No credentials in ordinary runner inputs.
- No automatic retry after `outcome_unknown`.
- No claim that cancellation reverses an accepted external action.

## Acceptance Before Implementation

Before adding the runtime API, write provider-neutral tests proving:

- packages cannot select a different workspace, connection, tool, or host;
- unauthorized operation ids fail closed;
- credential material cannot enter result or observability payloads;
- idempotent duplicate submission dispatches externally once;
- timeout after dispatch becomes `outcome_unknown`;
- reconciliation is required before operator retry;
- revocation and every applicable kill switch block new dispatch;
- cross-tenant operation lookup returns `404`.
