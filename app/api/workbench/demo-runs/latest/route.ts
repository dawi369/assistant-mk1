import { NextResponse } from "next/server";

import { getLatestDemoRunSnapshot } from "@/lib/workbench/demo-runtime";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    snapshot: getLatestDemoRunSnapshot(),
  });
}
