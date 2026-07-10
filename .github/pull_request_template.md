## Summary

-

## Verification

- [ ] `pnpm verify`
- [ ] Relevant service-boundary smoke
- [ ] `pnpm test:e2e` when the visible workbench, session gate, or recovery flow changed

## Boundaries

- [ ] Tenant scope remains server-derived.
- [ ] Secrets and private payloads are absent from browser responses, logs, fixtures, and screenshots.
- [ ] Current-state docs match the implementation.
- [ ] Destructive D1 reset or deployment steps are called out explicitly.
