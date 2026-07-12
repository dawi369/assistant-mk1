import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "The deployment-wide external-signal endpoint has been retired.",
      migration: "Use a configured Agent Pack webhook trigger at /api/external-signals/:publicId.",
    },
    { status: 410 },
  );
}
