import { NextResponse } from "next/server";

import { materializeChatSessionTurn } from "@/lib/workbench/cloudflare-control-plane-client";

export async function POST(request: Request) {
  const startedAt = Date.now();
  let clientWarmSession = false;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      clientWarmSession?: unknown;
      message?: unknown;
    };
    clientWarmSession = body.clientWarmSession === true;
    if (typeof body.message !== "string") {
      console.info("workbench.chat_session.materialize_turn", {
        clientWarmSession,
        durationMs: Date.now() - startedAt,
        ok: false,
        reason: "invalid-message",
      });
      return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
    }
    const response = await materializeChatSessionTurn({ message: body.message });
    console.info("workbench.chat_session.materialize_turn", {
      clientWarmSession,
      durationMs: Date.now() - startedAt,
      ok: true,
    });
    return NextResponse.json(response);
  } catch (error) {
    console.info("workbench.chat_session.materialize_turn", {
      clientWarmSession,
      durationMs: Date.now() - startedAt,
      ok: false,
    });
    const message = error instanceof Error ? error.message : "Failed to materialize chat turn";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
