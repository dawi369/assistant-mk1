/**
 * Lightweight runtime health endpoint for local and Fly staging checks.
 *
 * This verifies that the Next server is serving and reports non-secret runtime
 * wiring. It deliberately does not call the model provider or validate durable
 * persistence.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "assistant-mk1",
    langGraphConfigured: Boolean(process.env.LANGGRAPH_API_URL),
    assistantId: process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID ?? null,
  });
}
