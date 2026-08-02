import { getTokenClaims, withAuth } from "@workos-inc/authkit-nextjs";
import { type NextRequest } from "next/server";

import { retryCloudflareWorkspaceDeletion } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await withAuth({ ensureSignedIn: true });
  const claims = await getTokenClaims<{ auth_time?: number }>();
  const authenticatedAt =
    typeof claims.auth_time === "number" ? new Date(claims.auth_time * 1_000).toISOString() : "";
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return workbenchJson(
    () =>
      retryCloudflareWorkspaceDeletion({
        workspaceName: typeof body.workspaceName === "string" ? body.workspaceName : "",
        reauthenticatedAt: auth.user ? authenticatedAt : "",
      }),
    "Cloudflare workspace purge retry failed",
    { status: 202 },
  );
}
