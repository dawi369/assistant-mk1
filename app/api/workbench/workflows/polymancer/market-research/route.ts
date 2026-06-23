import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { runPolymancerMarketResearch } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      executionMode?: unknown;
      input?: Record<string, unknown>;
    };
    return NextResponse.json(
      await runPolymancerMarketResearch({
        executionMode: body.executionMode === "dry_run" ? "dry_run" : undefined,
        input:
          body.input && typeof body.input === "object" && !Array.isArray(body.input)
            ? body.input
            : {},
      }),
      { status: 201 },
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Polymancer market research workflow failed");
  }
}
