import { isRecord } from "./http";
import type { ChatRunRow, ExecutionMode } from "./types";

export type ChatPolicyResult = {
  decision: "allow" | "block";
  executionMode: ExecutionMode;
  reason: string;
  status: 200 | 403 | 409;
};

const executionModes = new Set<ExecutionMode>(["ask", "dry_run", "execute"]);

export const deriveChatExecutionMode = (body: unknown) => {
  const requested = isRecord(body) ? body.execution_mode : undefined;
  if (typeof requested !== "string") {
    return { executionMode: "ask" as const, requestedExecutionMode: undefined };
  }

  if (executionModes.has(requested as ExecutionMode)) {
    return {
      executionMode: requested as ExecutionMode,
      requestedExecutionMode: requested,
    };
  }

  return {
    executionMode: "ask" as const,
    invalidExecutionMode: requested,
    requestedExecutionMode: requested,
  };
};

export const evaluateChatRunPolicy = (input: {
  executionMode: ExecutionMode;
  invalidExecutionMode?: string;
  runningRun: ChatRunRow | null;
}): ChatPolicyResult => {
  if (input.invalidExecutionMode) {
    return {
      decision: "block",
      executionMode: input.executionMode,
      reason: `Unsupported chat execution mode: ${input.invalidExecutionMode}`,
      status: 403,
    };
  }

  if (input.runningRun) {
    return {
      decision: "block",
      executionMode: input.executionMode,
      reason: "A chat run is already running for this thread",
      status: 409,
    };
  }

  if (input.executionMode === "execute") {
    return {
      decision: "block",
      executionMode: input.executionMode,
      reason: "Chat execute mode is blocked until approval policy exists",
      status: 403,
    };
  }

  return {
    decision: "allow",
    executionMode: input.executionMode,
    reason: `Chat ${input.executionMode} mode is allowed by dev policy`,
    status: 200,
  };
};
