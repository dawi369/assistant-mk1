import {
  getCloudflareClientDevices,
  registerCloudflareClientDevice,
} from "@/lib/workbench/cloudflare-control-plane-client";
import { workbenchJson } from "@/lib/workbench/route-handler";

export const runtime = "nodejs";

export const GET = () => workbenchJson(getCloudflareClientDevices, "Device listing failed");

export const POST = async (request: Request) => {
  const body = await request.json();
  return workbenchJson(() => registerCloudflareClientDevice(body), "Device registration failed");
};
