// Thin compatibility export for the supported Admin HTTP surface. Runtime execution,
// policy, approvals, and catalog projection live in cohesive modules.
import { isRecord, json, parseJson } from "./http";
import { handleRuntimeAdminTool } from "./runtime-admin-tool";
import type { IncomingRuntimeTrace } from "./runtime-traces";
import type { AgentIdentity, Env } from "./types";

export {
  approveApprovalAndResumeRun,
  denyApprovalAndCancelRun,
  handleApproveToolApproval,
  handleDenyToolApproval,
  handleListToolApprovals,
} from "./tool-approvals";
export { handleListTools, handleUpdateToolPolicy } from "./tool-policy-admin";

export const handleRunTool = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  _incomingTrace?: IncomingRuntimeTrace,
) => {
  const body = parseJson(await request.text());
  const response = await handleRuntimeAdminTool(request, body, env, identity);
  if (response) return response;
  const toolName = isRecord(body) && typeof body.toolName === "string" ? body.toolName : "";
  return json(
    {
      ok: false,
      error: "Unsupported tool",
      details: {
        code: "unsupported_tool",
        message: toolName
          ? `${toolName} is not registered for the active agent.`
          : "A registered tool name is required.",
        retryable: false,
        redacted: true,
      },
    },
    { status: 400 },
  );
};
