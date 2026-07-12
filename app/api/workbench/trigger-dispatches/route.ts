import { type NextRequest } from "next/server";

import { getCloudflareTriggerDispatches } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const triggerId = params.get("triggerId") ?? undefined;
  const limitValue = params.get("limit");
  return workbenchJson(
    () =>
      getCloudflareTriggerDispatches({
        ...(triggerId ? { triggerId } : {}),
        ...(limitValue !== null ? { limit: Number(limitValue) } : {}),
      }),
    "Cloudflare trigger dispatch list failed",
  );
}
