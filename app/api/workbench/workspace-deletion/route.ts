import { getTokenClaims, withAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest } from "next/server";

import {
  getCloudflareWorkspaceDeletion,
  recoverCloudflareWorkspace,
  requestCloudflareWorkspaceDeletion,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function GET() {
  return workbenchJson(
    () => getCloudflareWorkspaceDeletion(),
    "Cloudflare workspace deletion request failed",
  );
}

export async function POST(request: NextRequest) {
  const auth = await withAuth({ ensureSignedIn: true });
  const claims = await getTokenClaims<{ auth_time?: number }>();
  const authenticatedAt =
    typeof claims.auth_time === "number" ? new Date(claims.auth_time * 1_000).toISOString() : "";
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return workbenchJson(
    () =>
      requestCloudflareWorkspaceDeletion({
        workspaceName: typeof body.workspaceName === "string" ? body.workspaceName : "",
        reauthenticatedAt: auth.user ? authenticatedAt : "",
      }),
    "Cloudflare workspace deletion request failed",
    { status: 202 },
  );
}

export async function DELETE() {
  await withAuth({ ensureSignedIn: true });
  return workbenchJson(() => recoverCloudflareWorkspace(), "Cloudflare workspace recovery failed");
}
