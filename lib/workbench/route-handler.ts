import { NextResponse } from "next/server";

import { toWorkbenchApiError } from "@/lib/workbench/api-errors";

export const workbenchJson = async <T>(
  operation: () => Promise<T>,
  errorMessage: string,
  init?: ResponseInit,
) => {
  try {
    return NextResponse.json(await operation(), init);
  } catch (error) {
    return toWorkbenchApiError(error, errorMessage);
  }
};
