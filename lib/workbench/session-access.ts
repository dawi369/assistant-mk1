import type { ChatSessionResponse } from "./workbench-types";

export const hasWorkbenchSessionAccess = (input: {
  hasWorkOsUser: boolean;
  session?: ChatSessionResponse | null;
  sessionError?: string | null;
}) =>
  input.hasWorkOsUser ||
  Boolean(input.session?.workspace && input.session.isStale !== true && !input.sessionError);
