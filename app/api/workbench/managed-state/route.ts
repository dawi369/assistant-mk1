import { type NextRequest } from "next/server";

import { getCloudflareManagedState } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const namespace = params.get("namespace") ?? undefined;
  const type = params.get("type") ?? undefined;
  const limitValue = params.get("limit");
  return workbenchJson(
    () =>
      getCloudflareManagedState({
        ...(namespace ? { namespace } : {}),
        ...(type ? { type } : {}),
        ...(limitValue !== null ? { limit: Number(limitValue) } : {}),
      }),
    "Cloudflare managed-state list failed",
  );
}
