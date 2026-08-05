import { revokeCloudflareClientDevice } from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export const DELETE = async (
  _request: Request,
  context: { params: Promise<{ deviceId: string }> },
) => {
  const { deviceId } = await context.params;
  return workbenchJson(() => revokeCloudflareClientDevice(deviceId), "Device revocation failed");
};
