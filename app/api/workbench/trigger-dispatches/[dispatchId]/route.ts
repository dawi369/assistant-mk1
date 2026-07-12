import { type NextRequest } from "next/server";

import { getCloudflareTriggerDispatch } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dispatchId: string }> },
) {
  const { dispatchId } = await params;
  return workbenchJson(
    () => getCloudflareTriggerDispatch(dispatchId),
    "Cloudflare trigger dispatch request failed",
  );
}
