# Fly.io Dev/Staging Deployment

Fly is the hosted dev/staging runtime. Local development remains the primary coding loop.

## Shape

The first Fly deployment runs both processes in one Machine:

- Next.js on `PORT`, default `3000`.
- LangGraph dev server on `LANGGRAPH_PORT`, default `2024`.
- Next proxies to LangGraph through `LANGGRAPH_API_URL=http://127.0.0.1:2024`.

This is intentionally simple for staging. Revisit service separation before treating it as production infrastructure.

## Required Secrets

Set secrets with `fly secrets set`; do not commit them.

```bash
fly secrets set OPENROUTER_API_KEY=...
fly secrets set EXTERNAL_SIGNAL_TOKEN=...
```

Optional:

```bash
fly secrets set LANGSMITH_API_KEY=...
fly secrets set LANGSMITH_TRACING=true
fly secrets set LANGSMITH_PROJECT=assistant-mk1-dev
fly secrets set LANGCHAIN_API_KEY=...
```

## First Deploy

```bash
fly apps create assistant-mk1-dev --region fra
fly deploy
```

If the app name is taken, change `app` and `OPENROUTER_SITE_URL` in `fly.toml`.

## Smoke Checks

Health:

```bash
curl https://assistant-mk1-dev.fly.dev/api/health
```

External signal:

```bash
curl -X POST https://assistant-mk1-dev.fly.dev/api/external-signals \
  -H "Authorization: Bearer $EXTERNAL_SIGNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","input":{"messages":[{"role":"user","content":"Say deployed smoke test ok."}]}}'
```

Frontend:

- Open the Fly URL.
- Send a message.
- Confirm a thread is created and streaming works.
- Confirm server logs do not expose provider secrets.

## Health Checks

`fly.toml` checks `/api/health`. That endpoint confirms the Next server is up and reports the configured LangGraph API URL and assistant id. It does not call the model provider.

## Persistence Warning

This first Fly setup does not mount volumes. Do not rely on local filesystem state for important work. Before production use, verify LangGraph persistence behavior across Machine restarts and choose durable persistence intentionally.
