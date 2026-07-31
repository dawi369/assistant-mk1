import { NextResponse, type NextRequest } from "next/server";

import { packWorkflowBindings } from "@/lib/agent-runtime/registry";
import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { runPackWorkflow } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workflowType: string }> },
) {
  const { workflowType } = await context.params;
  const binding = packWorkflowBindings[workflowType];
  if (!binding) {
    return NextResponse.json({ ok: false, error: "Workflow not found" }, { status: 404 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      executionMode?: unknown;
      input?: unknown;
    };
    const input =
      body.input && typeof body.input === "object" && !Array.isArray(body.input)
        ? (body.input as Record<string, unknown>)
        : {};
    return NextResponse.json(
      await runPackWorkflow(workflowType, {
        executionMode: body.executionMode === "dry_run" ? "dry_run" : undefined,
        input,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toWorkbenchApiError(error, `${binding.label} workflow failed`);
  }
}
