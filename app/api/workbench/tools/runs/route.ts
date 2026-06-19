import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  runCloudflareTool,
  type RunnableAdminToolName,
} from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

const runnableTools = new Set<RunnableAdminToolName>([
  "url.inspect",
  "repo.snapshot",
  "diagnostic.ping",
  "runner.echo",
  "artifact.metadata.test",
]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      toolName?: unknown;
      executionMode?: unknown;
      input?: Record<string, unknown>;
      parentRunId?: unknown;
    };
    if (
      typeof body.toolName !== "string" ||
      !runnableTools.has(body.toolName as RunnableAdminToolName)
    ) {
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
    if (
      toolName === "diagnostic.ping" ||
      toolName === "runner.echo" ||
      toolName === "artifact.metadata.test"
    ) {
      return NextResponse.json(
        await runCloudflareTool({
          toolName,
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
