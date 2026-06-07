/**
 * Token-protected ingress for external workflow signals.
 *
 * Outside systems use this route to start work, resume interrupted runs, or
 * create LangGraph crons. It is intentionally server-side and bearer-token
 * protected so external triggers do not bypass runtime authentication checks.
 */
import { timingSafeEqual } from "node:crypto";

import { Client } from "@langchain/langgraph-sdk";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

type SignalAction = "start" | "resume" | "create_cron";

type ExternalSignalPayload = {
  action: SignalAction;
  assistantId?: string;
  threadId?: string;
  input?: Record<string, unknown> | null;
  command?: unknown;
  schedule?: string;
  timezone?: string;
  webhook?: string;
  metadata?: Record<string, unknown>;
};

const constantTimeEqual = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

const getBearerToken = (req: NextRequest) => {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
};

const getClient = () => {
  const apiUrl = process.env.LANGGRAPH_API_URL;
  if (!apiUrl) {
    throw new Error("LANGGRAPH_API_URL is not configured");
  }
  return new Client({
    apiUrl,
    apiKey:
      process.env.LANGCHAIN_API_KEY || process.env.CLOUDFLARE_CONTROL_PLANE_DEV_TOKEN || undefined,
  });
};

const getAssistantId = (payload: ExternalSignalPayload) => {
  const assistantId = payload.assistantId ?? process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID;
  if (!assistantId) {
    throw new Error("assistantId is required");
  }
  return assistantId;
};

export async function POST(req: NextRequest) {
  const expectedToken = process.env.EXTERNAL_SIGNAL_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: "EXTERNAL_SIGNAL_TOKEN is not configured" }, { status: 503 });
  }

  const provided = getBearerToken(req);
  if (!provided || !constantTimeEqual(provided, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ExternalSignalPayload;
  try {
    payload = (await req.json()) as ExternalSignalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const client = getClient();
    const assistantId = getAssistantId(payload);
    const metadata = {
      source: "external-signal",
      ...payload.metadata,
    };

    if (payload.action === "create_cron") {
      if (!payload.schedule) {
        return NextResponse.json(
          { error: "schedule is required for create_cron" },
          { status: 400 },
        );
      }

      const cron = await client.crons.create(assistantId, {
        schedule: payload.schedule,
        timezone: payload.timezone,
        input: payload.input ?? null,
        metadata,
        webhook: payload.webhook,
      });

      return NextResponse.json({ cron });
    }

    const thread = payload.threadId
      ? await client.threads.get(payload.threadId)
      : await client.threads.create({ metadata, graphId: assistantId });

    const run = await client.runs.create(thread.thread_id, assistantId, {
      input: payload.action === "start" ? (payload.input ?? null) : null,
      command: payload.action === "resume" ? (payload.command as never) : undefined,
      metadata,
      webhook: payload.webhook,
      multitaskStrategy: "enqueue",
    });

    return NextResponse.json({
      threadId: thread.thread_id,
      run,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      error instanceof Error && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
