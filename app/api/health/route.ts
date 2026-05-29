import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "assistant-mk1",
    langGraphApiUrl: process.env.LANGGRAPH_API_URL ?? null,
    assistantId: process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID ?? null,
  });
}
