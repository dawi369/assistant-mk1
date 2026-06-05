import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getWorkspaceContext } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getWorkspaceContext());
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare workspace context request failed");
  }
}
