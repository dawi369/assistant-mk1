import type { WorkbenchAgentIdentity } from "./agent-identity-types";
import {
  loadMobileAccessTokenConfig,
  parseAuthoritativeBearer,
  verifyWorkbenchMobileAccessToken,
  type MobileAccessTokenConfig,
} from "./mobile-access-token";

export const resolveWorkbenchAgentIdentity = async (input: {
  authorization: string | null;
  cookieIdentity: () => Promise<WorkbenchAgentIdentity>;
  mobileConfig?: MobileAccessTokenConfig;
  mobileKey?: Parameters<typeof verifyWorkbenchMobileAccessToken>[2];
}) => {
  const bearer = parseAuthoritativeBearer(input.authorization);
  if (bearer) {
    return verifyWorkbenchMobileAccessToken(
      bearer,
      input.mobileConfig ?? loadMobileAccessTokenConfig(),
      input.mobileKey,
    );
  }
  return input.cookieIdentity();
};
