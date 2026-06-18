import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  createChatSessionThread,
  getChatSessionThreads,
} from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const status =
      new URL(request.url).searchParams.get("status") === "archived" ? "archived" : "active";
    return NextResponse.json(await getChatSessionThreads({ status }));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session threads request failed");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { title?: unknown };
    return NextResponse.json(
      await createChatSessionThread({
        title: typeof body.title === "string" ? body.title : undefined,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare chat session thread creation failed");
  }
}
