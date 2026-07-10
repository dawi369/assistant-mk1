# Evals

Assistant-mk1 treats real-session evals as runtime contract checks, not offline
prompt grading.

Real-session evals should drive the same HTTP/session/runtime surfaces that a
user or operator hits and assert on durable product state: messages, runs,
threads, tool calls, approvals, HITL state, events, traces, artifacts, and
tenant isolation.

## Current v0

The current v0 is a manifest plus verifier:

```bash
pnpm eval:real-session-posture
```

The manifest lives in `lib/workbench/real-session-evals.ts`. The verifier checks
that required real-session assertions are covered and that each referenced
package script still exists.

Current real-session suites:

- `pnpm smoke:cloudflare-chat-session-lifecycle`
- `pnpm smoke:cloudflare-membership-policy`
- `pnpm smoke:cloudflare-tool-admin`
- `pnpm smoke:cloudflare-runtime-traces`
- `pnpm smoke:cloudflare-event-stream`
- `pnpm smoke:fly-tool-runner`

Supporting contract checks are allowed, but they are not counted as real-session
evals. Today `pnpm test:unit -- lib/workbench/schedule-dispatch.test.ts` guards
the schedule-dispatch contract until a live LangGraph-backed external-signal
smoke exists.

## Not In v0

- No LLM judge.
- No new eval service.
- No production schedule replay harness.
- No browser automation grading loop.
- No stored prompt/message corpus.

Add those only after the runtime contract gaps are visible in the current smoke
suite.
