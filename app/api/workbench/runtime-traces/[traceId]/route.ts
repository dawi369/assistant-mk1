import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getRuntimeTrace } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    traceId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { traceId } = await context.params;
    return NextResponse.json(await getRuntimeTrace(traceId));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare runtime trace request failed");
  }
}
