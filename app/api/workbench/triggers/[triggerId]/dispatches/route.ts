import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { createCloudflareTriggerDispatch } from "@/lib/workbench/cloudflare-control-plane-client";
import type { CreateTriggerDispatchInput } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ triggerId: string }> },
) {
  const { triggerId } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateTriggerDispatchInput>;
    const result = await createCloudflareTriggerDispatch(triggerId, {
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      ...(body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? { payload: body.payload }
        : {}),
      ...(typeof body.scheduledFor === "string" ? { scheduledFor: body.scheduledFor } : {}),
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare trigger dispatch failed");
  }
}
