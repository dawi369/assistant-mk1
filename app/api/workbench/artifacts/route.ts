import { NextResponse, type NextRequest } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";
import { createCloudflareArtifactBlob } from "@/lib/workbench/cloudflare-control-plane-client";
import type { CreateArtifactBlobInput } from "@/lib/workbench/workbench-types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateArtifactBlobInput>;
    const result = await createCloudflareArtifactBlob({
      kind: typeof body.kind === "string" ? body.kind : "",
      title: typeof body.title === "string" ? body.title : undefined,
      mimeType: typeof body.mimeType === "string" ? body.mimeType : "",
      contentBase64: typeof body.contentBase64 === "string" ? body.contentBase64 : "",
      retentionClass: "standard",
      data:
        body.data && typeof body.data === "object" && !Array.isArray(body.data)
          ? body.data
          : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toWorkbenchApiError(error, "Cloudflare artifact creation failed");
  }
}
