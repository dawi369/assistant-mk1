import { NextResponse } from "next/server";

export const toWorkbenchApiError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;
  const status =
    error instanceof Error && "status" in error && typeof error.status === "number"
      ? error.status
      : 502;

  console.error(fallback, {
    status,
    error: message,
    name: error instanceof Error ? error.name : "UnknownError",
  });

  return NextResponse.json(
    { error: message },
    { status },
  );
};
