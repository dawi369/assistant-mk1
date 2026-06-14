import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { updateCloudflareToolPolicy } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      toolName?: unknown;
      status?: unknown;
      requiresApproval?: unknown;
      killSwitchReason?: unknown;
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
    if (body.status !== undefined && body.status !== "enabled" && body.status !== "disabled") {
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
    if (body.requiresApproval !== undefined && typeof body.requiresApproval !== "boolean") {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported approval flag",
          details: {
            code: "unsupported_requires_approval",
            message: "requiresApproval must be a boolean when provided.",
            retryable: false,
            redacted: true,
          },
        },
        { status: 400 },
      );
    }
    if (body.killSwitchReason !== undefined && typeof body.killSwitchReason !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported kill-switch reason",
          details: {
            code: "unsupported_kill_switch_reason",
            message: "killSwitchReason must be a string when provided.",
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
        requiresApproval: body.requiresApproval,
        killSwitchReason: body.killSwitchReason,
      }),
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare tool policy update failed");
  }
}
