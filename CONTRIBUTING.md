# Contributing

Assistant-mk1 is production-oriented application code. Changes should preserve
the Vercel session, Cloudflare control-plane, and Fly execution boundaries while
keeping the reusable assistant-ui layer product-agnostic.

## Development Setup

Requirements:

- Node.js 22
- pnpm 10.33.0
- Chromium for the Playwright release suite (`pnpm exec playwright install chromium`)
- a Cloudflare account for remote Worker work
- a WorkOS environment for hosted authentication work

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
cp cloudflare/control-plane/.dev.vars.example cloudflare/control-plane/.dev.vars
```

The local D1 schema is currently reset-based. On first setup, or when you
intentionally want to discard local Worker data:

```bash
pnpm db:cloudflare:rebuild:local
```

Start the complete workbench:

```bash
pnpm dev:workbench
```

The frontend runs at `http://localhost:3000`, LangGraph at
`http://localhost:2024`, and the Cloudflare Worker at
`http://localhost:8787`.

## Change Workflow

1. Read `docs/README.md` and the current-state document for the affected area.
2. Keep the change inside the existing ownership boundary.
3. Add behavior-focused tests near the changed module.
4. Run `pnpm verify:fast` while iterating.
5. Run `pnpm verify` before opening a pull request.
6. Run `pnpm test:e2e` when the visible workbench, session gate, or recovery flow changes.
7. Run the affected Cloudflare or Fly smoke when behavior crosses a service boundary.

`pnpm test:e2e` rebuilds only its isolated D1 fixture in
`output/playwright/state`; it does not touch the normal local Worker database.
Use `pnpm release:check` for the complete code, build, and browser gate.
Local Markdown and image links are enforced by `pnpm docs:check`, which is also
part of `pnpm verify:fast`.

## Architecture Rules

- Browser code never chooses tenant scope, user IDs, workspace IDs, or secrets.
- Vercel derives WorkOS session identity and signs requests to Cloudflare.
- Cloudflare owns application authorization, durable control state, policy, and audit.
- Fly/LangGraph receives scoped work only through signed server-side contracts.
- `components/assistant-ui/*` remains reusable; product composition belongs in
  `components/workbench/*`.
- Mutation-capable tools remain blocked until the production gates in
  `docs/implementation-roadmap.md` are complete.

## Pull Request Checklist

- [ ] The behavior change has focused tests.
- [ ] Tenant and role boundaries have negative coverage when durable state changes.
- [ ] Errors returned to users are actionable and redacted.
- [ ] Current-state docs match the implementation.
- [ ] `pnpm verify` passes.
- [ ] `pnpm test:e2e` passes for user-visible or session changes.
- [ ] Relevant local or hosted smoke commands and results are included.

Do not include credentials, `.env.local`, `.dev.vars`, production payloads, or
private tenant data in issues, fixtures, screenshots, or pull requests.
