const userIdHeader = "x-assistant-mk1-user-id";
const accountIdHeader = "x-assistant-mk1-account-id";
const accountSourceHeader = "x-assistant-mk1-account-source";
const userEmailHeader = "x-assistant-mk1-user-email";
const userNameHeader = "x-assistant-mk1-user-name";
const membershipRoleHeader = "x-assistant-mk1-membership-role";
const membershipRolesHeader = "x-assistant-mk1-membership-roles";
const membershipPermissionsHeader = "x-assistant-mk1-membership-permissions";
const workspaceNameHeader = "x-assistant-mk1-workspace-name";

type EnvMap = Record<string, string | undefined>;

const readRequired = (env: EnvMap, key: string) => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for external signal control-plane identity`);
  return value;
};

const readOptional = (env: EnvMap, key: string) => env[key]?.trim() || undefined;

export const getExternalSignalIdentityHeaders = (
  env: EnvMap = process.env,
): Record<string, string> => {
  const headers: Record<string, string> = {
    [userIdHeader]: readRequired(env, "EXTERNAL_SIGNAL_USER_ID"),
    [accountIdHeader]: readRequired(env, "EXTERNAL_SIGNAL_ACCOUNT_ID"),
    [accountSourceHeader]: readRequired(env, "EXTERNAL_SIGNAL_ACCOUNT_SOURCE"),
  };

  const optionalHeaders: Array<[string, string | undefined]> = [
    [userEmailHeader, readOptional(env, "EXTERNAL_SIGNAL_USER_EMAIL")],
    [userNameHeader, readOptional(env, "EXTERNAL_SIGNAL_USER_NAME")],
    [membershipRoleHeader, readOptional(env, "EXTERNAL_SIGNAL_MEMBERSHIP_ROLE")],
    [membershipRolesHeader, readOptional(env, "EXTERNAL_SIGNAL_MEMBERSHIP_ROLES")],
    [membershipPermissionsHeader, readOptional(env, "EXTERNAL_SIGNAL_MEMBERSHIP_PERMISSIONS")],
    [workspaceNameHeader, readOptional(env, "EXTERNAL_SIGNAL_WORKSPACE_NAME")],
  ];

  for (const [header, value] of optionalHeaders) {
    if (value) headers[header] = value;
  }

  return headers;
};
