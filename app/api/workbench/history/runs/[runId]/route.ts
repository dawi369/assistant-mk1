import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { getExecutionHistoryRun } from "@/lib/workbench/cloudflare-control-plane-client";

export const runtime = "nodejs";

type Params = {
  runId: string;
};

export async function GET(_request: NextRequest, { params }: { params: Promise<Params> }) {
  const { runId } = await params;
  try {
    return NextResponse.json(await getExecutionHistoryRun(runId));
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare run history request failed");
  }
}
