# Architecture

Assistant-MK1 is an agent workbench with a hosted Fly.io dev/staging runtime.

## System Shape

- Next.js App Router serves the frontend and API routes.
- assistant-ui renders the thread, composer, messages, reasoning, tools, and attachments.
- `@assistant-ui/react-langgraph` adapts the UI runtime to LangGraph threads and streams.
- LangGraph runs the backend graph exported from `backend/agent.ts`.
- OpenRouter is configured server-side through `ChatOpenRouter`.
- Fly.io runs the staging environment after local feature implementation.

## Important Seams

- `app/assistant.tsx`: creates the LangGraph SDK client and assistant-ui runtime.
- `lib/chatApi.ts`: decides whether the browser talks to `/api` or a direct LangGraph URL.
- `app/api/[..._path]/route.ts`: Next.js catch-all proxy for LangGraph API requests. The bracketed folder name is framework syntax, not a project-specific naming convention.
- `app/api/external-signals/route.ts`: accepts token-protected external starts, resumes, and cron creation.
- `backend/agent.ts`: owns provider/model choice and graph behavior.
- `langgraph.json`: maps graph id `agent` to the compiled graph.

## Runtime Boundaries

The frontend should not know about model provider secrets, tool credentials, or deployment-only configuration. It should know about workbench concepts: current thread, run state, interrupts, artifacts, and messages.

The backend graph should own agent reasoning and tool execution. Long-running workflows should use LangGraph runs and threads rather than frontend timers.

External systems should enter through authenticated API routes, not through direct browser-only flows.

## Deployment Boundary

Local development runs both servers:

```bash
pnpm dev
```

Fly staging runs the same logical pair in one container:

```bash
pnpm start:fly
```

That single-container Fly shape is intentional for the dev/staging phase. If this becomes production infrastructure, revisit whether Next and LangGraph should be split into separate services and whether persistence should be managed by LangGraph Platform or an explicit database-backed deployment.
