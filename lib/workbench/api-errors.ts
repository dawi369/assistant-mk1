import { NextResponse } from "next/server";

export const toWorkbenchApiError = (error: unknown, fallback: string) => {
  const status =
    error instanceof Error && "status" in error && typeof error.status === "number"
      ? error.status
      : 502;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status },
  );
};
