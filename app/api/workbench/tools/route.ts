import { getCloudflareTools } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const stages = new Set(["observe", "analyze", "propose", "execute", "review"]);
const executionModes = new Set(["ask", "dry_run", "execute"]);
const surfaces = new Set([
  "admin_list",
  "admin_run",
  "admin_resume",
  "model_exposure",
  "model_tool_call",
]);

const readSafeParam = (request: NextRequest, name: string, allowed: Set<string>) => {
  const value = request.nextUrl.searchParams.get(name);
  return value && allowed.has(value) ? value : undefined;
};

export async function GET(request: NextRequest) {
  return workbenchJson(
    () =>
      getCloudflareTools({
        stage: readSafeParam(request, "stage", stages) as
          | "observe"
          | "analyze"
          | "propose"
          | "execute"
          | "review"
          | undefined,
        executionMode: readSafeParam(request, "executionMode", executionModes) as
          | "ask"
          | "dry_run"
          | "execute"
          | undefined,
        surface: readSafeParam(request, "surface", surfaces) as
          | "admin_list"
          | "admin_run"
          | "admin_resume"
          | "model_exposure"
          | "model_tool_call"
          | undefined,
        featureFlags: request.nextUrl.searchParams.get("featureFlags") ?? undefined,
      }),
    "Cloudflare tools request failed",
  );
}
