import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  createCloudflareTrigger,
  getCloudflareTriggers,
} from "@/lib/workbench/cloudflare-control-plane-client";
import type { CreateTriggerInput } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  try {
    return NextResponse.json(await getCloudflareTriggers(limit));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare trigger list failed");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateTriggerInput>;
    const result = await createCloudflareTrigger({
      packId: typeof body.packId === "string" ? body.packId : "",
      packTriggerId: typeof body.packTriggerId === "string" ? body.packTriggerId : "",
      ...(body.status ? { status: body.status } : {}),
      ...(body.input && typeof body.input === "object" && !Array.isArray(body.input)
        ? { input: body.input }
        : {}),
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare trigger creation failed");
  }
}
