import { NextResponse } from "next/server";

import { getWorkbenchAdminAccess } from "@/lib/workbench/admin-access";
import { toWorkbenchApiError } from "@/lib/workbench/api-errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getWorkbenchAdminAccess());
  } catch (error) {
    return toWorkbenchApiError(error, "Workbench admin access request failed", {
      defaultStatus: 401,
    });
  }
}
