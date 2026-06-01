import { NextResponse } from "next/server";

import { getLatestDemoRunSnapshot, startDemoInspectRun } from "@/lib/workbench/demo-runtime";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    snapshot: getLatestDemoRunSnapshot(),
  });
}

export async function POST() {
  const snapshot = await startDemoInspectRun();
  return NextResponse.json({ snapshot }, { status: 201 });
}
