import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { updateCloudflareToolPolicy } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      toolName?: unknown;
      status?: unknown;
    };
    if (body.toolName !== "url.inspect") {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported tool",
          details: {
            code: "unsupported_tool",
            message: "Only url.inspect policy can be updated through this v0 endpoint.",
            retryable: false,
            redacted: true,
          },
        },
        { status: 400 },
      );
    }
    if (body.status !== "enabled" && body.status !== "disabled") {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported policy status",
          details: {
            code: "unsupported_policy_status",
            message: "Policy status must be enabled or disabled.",
            retryable: false,
            redacted: true,
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await updateCloudflareToolPolicy({
        toolName: "url.inspect",
        status: body.status,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare tool policy update failed");
  }
}
