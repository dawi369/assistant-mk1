/**
 * Stable connection-broker facade. Implementation is split by authority boundary so
 * raw credentials remain confined to OAuth, provider execution, and Vault modules.
 */
export {
  handleConnectionHealth,
  handleListConnections,
  handleRevokeConnection,
  handleStoreConnectionCredential,
  revokeWorkspaceConnections,
} from "./connection-broker-connections";
export {
  expireConnectionOAuthStates,
  handleCompleteConnectionAuthorization,
  handleRefreshConnection,
  handleStartConnectionAuthorization,
} from "./connection-broker-oauth";
export {
  handleRedeemConnectionCapability,
  issueFlyConnectionCapability,
} from "./connection-broker-capabilities";
export {
  connectionSecretFingerprint,
  createBrokeredConnectionPort,
} from "./connection-broker-port";
export type { FlyConnectionCapabilityEnvelope } from "./connection-broker-shared";
