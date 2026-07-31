import { packWorkflowBindings, resolvePackRuntime } from "../../../lib/agent-runtime/registry";
import { coreWorkflowProvider } from "./core-workflow-provider";
import { handleGenericRuntimeWorkflow } from "./generic-workflow-kernel";
import { resolveAgentBehaviorConfig } from "./agent-records";
import { selectAgent } from "./authz-store";
import { json } from "./http";
import type { AgentIdentity, Env } from "./types";

export type WorkflowInvocationContext =
  | { source: "user" }
  | {
      source: "trigger";
      triggerId: string;
      dispatchId: string;
      leaseOwner: string;
      triggerSource: "manual" | "schedule" | "monitor" | "webhook" | "replay";
      attemptCount: number;
      idempotencyKey: string;
      scheduledFor: string | null;
      previousRunId: string | null;
    };

export type PackWorkflowHandler = (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  invocation: WorkflowInvocationContext,
) => Promise<Response>;

export const packWorkflowHandlerForType = (workflowType: string): PackWorkflowHandler | null => {
  const binding = packWorkflowBindings[workflowType];
  if (!binding) return null;
  return async (request, env, identity, invocation) => {
    const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
    const pack = resolveAgentBehaviorConfig(agent).pack;
    if (!pack || pack.id !== binding.requiredPackId) {
      return json(
        { ok: false, error: "The active agent pack does not own this workflow." },
        {
          status: 403,
        },
      );
    }
    const runtime = resolvePackRuntime(pack.id, pack.version);
    if (!runtime.runnable) {
      return json(
        {
          ok: false,
          error:
            "This historical agent remains chat-capable but requires a compatible runtime upgrade before workflows can run.",
          details: { code: "runtime_incompatible", redacted: true },
        },
        { status: 409 },
      );
    }
    const core = coreWorkflowProvider[workflowType];
    return core
      ? core(request, env, identity, invocation)
      : handleGenericRuntimeWorkflow(workflowType, request, env, identity, invocation);
  };
};

export const packWorkflowHandlers = new Proxy<Record<string, PackWorkflowHandler>>(
  {},
  {
    get: (_target, workflowType) =>
      typeof workflowType === "string" ? packWorkflowHandlerForType(workflowType) : undefined,
  },
);

export const packWorkflowHandlerForPath = (pathname: string): PackWorkflowHandler | null => {
  const prefix = "/workbench/workflows/";
  if (!pathname.startsWith(prefix)) return null;
  const workflowType = decodeURIComponent(pathname.slice(prefix.length));
  return packWorkflowHandlerForType(workflowType);
};
