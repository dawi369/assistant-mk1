import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import {
  createCloudflareWorkspace,
  getCloudflareWorkspaces,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(getCloudflareWorkspaces, "Cloudflare workspaces request failed");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    return NextResponse.json(await createCloudflareWorkspace({ name }), { status: 201 });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare workspace creation failed");
  }
}
