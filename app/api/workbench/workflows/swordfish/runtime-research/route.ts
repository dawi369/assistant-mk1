import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { runSwordfishRuntimeResearch } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      executionMode?: unknown;
      input?: unknown;
    };
    return NextResponse.json(
      await runSwordfishRuntimeResearch({
        executionMode: body.executionMode === "dry_run" ? "dry_run" : undefined,
        input:
          typeof body.input === "object" && body.input !== null && !Array.isArray(body.input)
            ? (body.input as Record<string, unknown>)
            : {},
      }),
      { status: 201 },
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Swordfish runtime research workflow failed");
  }
}
