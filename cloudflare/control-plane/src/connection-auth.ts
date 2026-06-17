export type ConnectionAuthPrincipal = "none" | "app" | "user";

export type ConnectionAuthStatus =
  | "not_required"
  | "authorization_required"
  | "authorized"
  | "refresh_required";

export type ConnectionAuthBrokerage = {
  required: boolean;
  status: ConnectionAuthStatus;
  principal: ConnectionAuthPrincipal;
  connectionName?: string;
  authorizationEventType?: "connection.authorization_required";
  tokenRefresh: "not_applicable" | "brokered";
  toolFilter: "not_required" | "connection_scoped";
  approvalOrder: "policy_before_connection" | "connection_before_policy";
  reason: string;
};

export const noConnectionAuthRequired = (toolName: string): ConnectionAuthBrokerage => ({
  required: false,
  status: "not_required",
  principal: "none",
  tokenRefresh: "not_applicable",
  toolFilter: "not_required",
  approvalOrder: "policy_before_connection",
  reason: `${toolName} does not require an external connection.`,
});

export const connectionAuthorizationRequired = (input: {
  toolName: string;
  principal: Exclude<ConnectionAuthPrincipal, "none">;
  connectionName: string;
}): ConnectionAuthBrokerage => ({
  required: true,
  status: "authorization_required",
  principal: input.principal,
  connectionName: input.connectionName,
  authorizationEventType: "connection.authorization_required",
  tokenRefresh: "brokered",
  toolFilter: "connection_scoped",
  approvalOrder: "connection_before_policy",
  reason: `${input.toolName} requires ${input.principal} authorization for ${input.connectionName}.`,
});

export const connectionAuthForTool = (toolName: string): ConnectionAuthBrokerage =>
  noConnectionAuthRequired(toolName);
