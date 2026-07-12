import { type NextRequest } from "next/server";

import {
  getCloudflareTrigger,
  updateCloudflareTrigger,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";
import type { UpdateTriggerInput } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

type Params = { triggerId: string };

export async function GET(_request: NextRequest, { params }: { params: Promise<Params> }) {
  const { triggerId } = await params;
  return workbenchJson(() => getCloudflareTrigger(triggerId), "Cloudflare trigger request failed");
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { triggerId } = await params;
  const body = (await request.json().catch(() => ({}))) as Partial<UpdateTriggerInput>;
  return workbenchJson(
    () =>
      updateCloudflareTrigger(triggerId, {
        expectedVersion:
          typeof body.expectedVersion === "number" ? body.expectedVersion : Number.NaN,
        ...(body.status ? { status: body.status } : {}),
        ...(body.input && typeof body.input === "object" && !Array.isArray(body.input)
          ? { input: body.input }
          : {}),
      }),
    "Cloudflare trigger update failed",
  );
}
