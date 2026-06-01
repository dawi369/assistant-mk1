import { NextResponse, type NextRequest } from "next/server";

import { getDemoRunSnapshot } from "@/lib/workbench/demo-runtime";

export const runtime = "nodejs";

type Params = {
  runId: string;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const { runId } = await params;
  const snapshot = getDemoRunSnapshot(runId);
  if (!snapshot) {
    return NextResponse.json({ error: "Demo run not found" }, { status: 404 });
  }

  return NextResponse.json({ snapshot });
}
