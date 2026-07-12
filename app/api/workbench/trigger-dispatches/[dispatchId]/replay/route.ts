import { type NextRequest } from "next/server";

import { replayCloudflareTriggerDispatch } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ dispatchId: string }> },
) {
  const { dispatchId } = await params;
  return workbenchJson(
    () => replayCloudflareTriggerDispatch(dispatchId),
    "Cloudflare trigger dispatch replay failed",
  );
}
