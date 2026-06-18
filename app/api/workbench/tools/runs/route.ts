import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { runCloudflareTool } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      toolName?: unknown;
      executionMode?: unknown;
      input?: { url?: unknown };
      parentRunId?: unknown;
    };
    if (body.toolName !== "url.inspect" && body.toolName !== "repo.snapshot") {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported tool",
          details: {
            code: "unsupported_tool",
            message: "Only url.inspect and repo.snapshot can run through this v0 endpoint.",
            retryable: false,
            redacted: true,
          },
        },
        { status: 400 },
      );
    }
    if (body.toolName === "repo.snapshot") {
      return NextResponse.json(
        await runCloudflareTool({
          toolName: "repo.snapshot",
          executionMode: body.executionMode === "dry_run" ? "dry_run" : undefined,
          input:
            body.input && typeof body.input === "object" && !Array.isArray(body.input)
              ? body.input
              : {},
        }),
        { status: 201 },
      );
    }
    return NextResponse.json(
      await runCloudflareTool({
        toolName: "url.inspect",
        executionMode: body.executionMode === "dry_run" ? "dry_run" : undefined,
        input: {
          url: body.input && typeof body.input.url === "string" ? body.input.url : "",
        },
        parentRunId: typeof body.parentRunId === "string" ? body.parentRunId : undefined,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare tool run failed");
  }
}
