# Security Policy

## Reporting A Vulnerability

Use GitHub's private security-advisory flow for vulnerabilities. Do not open a
public issue containing exploit details, credentials, private tenant data, or a
reproduction against the hosted deployment.

Include:

- the affected route, module, or deployment surface
- the security boundary that failed
- impact and prerequisites
- a minimal reproduction using synthetic data
- any suggested containment

Reports should not test destructive behavior against infrastructure or data you
do not own.

## Supported Surface

Security fixes target the current `main` branch and the hosted read-only
workbench. The repository does not currently claim durable customer-data
retention or support mutation-capable production tools.

## Security Boundaries

- WorkOS AuthKit owns hosted authentication and browser sessions.
- Vercel derives identity server-side and signs facade requests.
- Cloudflare owns workspace membership, role enforcement, policy, audit, and
  tenant-scoped durable state.
- The browser never supplies trusted tenant IDs or credentials.
- Tool provider keys and runner signing secrets remain server-side.
- Cross-tenant reads return no resource details.

The production gates for encrypted secret custody, non-destructive migrations,
retention, and external mutation are tracked in
`docs/implementation-roadmap.md` and `docs/migrations-and-retention.md`.
