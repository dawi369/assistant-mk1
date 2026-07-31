import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  runCloudflareTool,
  type RunnableAdminToolName,
} from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      toolName?: unknown;
      executionMode?: unknown;
      input?: Record<string, unknown>;
      parentRunId?: unknown;
    };
    if (typeof body.toolName !== "string" || !/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(body.toolName)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported tool",
          details: {
            code: "unsupported_tool",
            message: "Only registered Admin dry-run tools can run through this endpoint.",
            retryable: false,
            redacted: true,
          },
        },
        { status: 400 },
      );
    }
    const toolName = body.toolName as RunnableAdminToolName;
    return NextResponse.json(
      await runCloudflareTool({
        toolName,
        executionMode: body.executionMode === "dry_run" ? "dry_run" : undefined,
        input:
          body.input && typeof body.input === "object" && !Array.isArray(body.input)
            ? body.input
            : {},
        parentRunId: typeof body.parentRunId === "string" ? body.parentRunId : undefined,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare tool run failed");
  }
}
