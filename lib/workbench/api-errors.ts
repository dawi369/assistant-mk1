import { NextResponse } from "next/server";

const getErrorStatus = (error: unknown, defaultStatus: number) =>
  error instanceof Error && "status" in error && typeof error.status === "number"
    ? error.status
    : defaultStatus;

const publicMessage = (error: unknown, fallback: string, status: number) => {
  if (status >= 500) return fallback;
  return error instanceof Error ? error.message : fallback;
};

export const toWorkbenchApiError = (
  error: unknown,
  fallback: string,
  options?: { defaultStatus?: number },
) => {
  const status = getErrorStatus(error, options?.defaultStatus ?? 502);
  const errorId = status >= 500 ? crypto.randomUUID() : undefined;
  const internalMessage = error instanceof Error ? error.message : fallback;
  const message = publicMessage(error, fallback, status);

  console.error(fallback, {
    errorId,
    status,
    error: internalMessage,
    name: error instanceof Error ? error.name : "UnknownError",
  });

  return NextResponse.json({ error: message, ...(errorId ? { errorId } : {}) }, { status });
};
