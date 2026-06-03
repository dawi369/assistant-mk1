# ADR-0005: Cloudflare LangGraph Facade

Status: accepted

## Context

Assistant-MK1 currently uses assistant-ui with the LangGraph SDK for chat
threads and streaming. The north-star runtime says Cloudflare should own the
user-facing control-plane boundary, while Fly remains the execution plane for
LangGraph and heavy tools.

Jumping directly to a custom Cloudflare chat runtime would force a frontend and
streaming rewrite before auth, durable thread state, and data-client expansion
are ready.

## Decision

Insert Cloudflare as a LangGraph-compatible facade between Vercel and Fly.

Vercel keeps the browser-facing `/api/*` contract used by assistant-ui. Its
server-side proxy sends trusted dev identity and dev control-plane auth to
Cloudflare. Cloudflare validates that boundary, then proxies `/langgraph/*` to
the Fly LangGraph runtime with the Fly gateway token.

Cloudflare must stream upstream responses through without buffering. This is a
stepping stone toward a real Cloudflare-owned conversational control plane, not
a permanent dumb proxy.

## Consequences

- Browser URLs and assistant-ui integration stay unchanged.
- Vercel no longer needs the Fly gateway token for chat traffic.
- Cloudflare becomes the chat/control-plane front door for hosted dev.
- Fly continues to own LangGraph execution and signed executor work.
- Future slices can add thread/run metadata, policy, context assembly, and
  audit at the Cloudflare boundary before replacing the LangGraph-compatible
  facade with a product-specific API.
