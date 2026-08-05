import {
  getCloudflareNotificationPreferences,
  updateCloudflareNotificationPreferences,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export const GET = () =>
  workbenchJson(getCloudflareNotificationPreferences, "Notification preferences failed");

export const PUT = async (request: Request) => {
  const body = await request.json();
  return workbenchJson(
    () => updateCloudflareNotificationPreferences(body),
    "Notification preferences failed",
  );
};
