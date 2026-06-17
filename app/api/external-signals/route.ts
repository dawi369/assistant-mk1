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

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  normalizeExternalSignal,
  type ExternalSignalPayload,
} from "@/lib/workbench/schedule-dispatch";

export const runtime = "nodejs";

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
    const normalized = normalizeExternalSignal(payload);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: normalized.status });
    }
    const signal = normalized.signal;
    const assistantId = getAssistantId(signal);

    if (signal.action === "create_cron") {
      const cron = await client.crons.create(assistantId, {
        schedule: signal.schedule ?? "",
        timezone: signal.timezone,
        input: signal.input,
        metadata: signal.metadata,
        webhook: signal.webhook,
      });

      return NextResponse.json({ cron });
    }

    const thread = signal.threadId
      ? await client.threads.get(signal.threadId)
      : await client.threads.create({ metadata: signal.metadata, graphId: assistantId });

    const run = await client.runs.create(thread.thread_id, assistantId, {
      input:
        signal.action === "start" || signal.action === "dispatch_schedule" ? signal.input : null,
      command: signal.action === "resume" ? (signal.command as never) : undefined,
      metadata: signal.metadata,
      webhook: signal.webhook,
      multitaskStrategy: "enqueue",
    });

    return NextResponse.json({
      threadId: thread.thread_id,
      run,
      dispatch: signal.scheduleDispatch,
    });
  } catch (error) {
    return toWorkbenchApiError(error, "External signal request failed", { defaultStatus: 500 });
  }
}
