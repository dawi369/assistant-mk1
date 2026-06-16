import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  createCloudflareAgent,
  getCloudflareAgents,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";
import type { AgentSummary } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(getCloudflareAgents, "Cloudflare agents request failed");
}

const agentProfiles = new Set(["default", "analyst", "operator"]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      profile?: unknown;
      model?: unknown;
      behaviorTemplateId?: unknown;
      activate?: unknown;
    };
    const profile =
      typeof body.profile === "string" && agentProfiles.has(body.profile)
        ? (body.profile as AgentSummary["profile"])
        : "default";
    return NextResponse.json(
      await createCloudflareAgent({
        name: typeof body.name === "string" ? body.name : "",
        description: typeof body.description === "string" ? body.description : undefined,
        profile,
        model: typeof body.model === "string" ? body.model : undefined,
        behaviorTemplateId:
          typeof body.behaviorTemplateId === "string" ? body.behaviorTemplateId : undefined,
        activate: body.activate === true,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare agent creation failed");
  }
}
