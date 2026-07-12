import { type NextRequest } from "next/server";

import { getCloudflareManagedStateRecord } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ stateId: string }> },
) {
  const { stateId } = await params;
  return workbenchJson(
    () => getCloudflareManagedStateRecord(stateId),
    "Cloudflare managed-state request failed",
  );
}
