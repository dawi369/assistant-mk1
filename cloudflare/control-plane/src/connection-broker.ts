import type {
  AgentPackConnectionDescriptor,
  ConnectionCapability,
  ConnectionPort,
} from "@assistant-mk1/agent-sdk/control-plane";

import { resolveAgentBehaviorConfig } from "./agent-records";
import { selectAgent, selectMembership } from "./authz-store";
import { resolveCredentialVault, type VaultObjectReference } from "./credential-vault";
import { connectionsEnabled } from "./feature-gates";
import { isRecord, json, parseJson } from "./http";
import { requireAdminMembership } from "./membership-policy";
import { prepareOperatorAlertStatement } from "./operator-alerts";
import {
  assertProviderRequest,
  requireConnectionProvider,
  type ConnectionProvider,
} from "./connection-providers";
import { createId, toJson, type AgentIdentity, type ControlConnectionRow, type Env } from "./types";

type StoredCredential = {
  kind: "api_key" | "oauth2";
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scopes: string[];
};

export type FlyConnectionCapabilityEnvelope = {
  url: string;
  token: string;
  connectionId: string;
  allowedUrl: string;
  allowedMethod: string;
  expiresAt: string;
};

const sha256Hex = async (value: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const randomBase64Url = (bytes = 32) => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const pkceChallenge = async (verifier: string) => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const parseStringList = (raw: string) => {
  const value = parseJson(raw);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};

const connectionSummary = (
  row: ControlConnectionRow | null,
  descriptor: AgentPackConnectionDescriptor,
) => ({
  id: descriptor.id,
  provider: descriptor.provider,
  principal: descriptor.principal,
  credentialClass: descriptor.credentialClass,
  required: descriptor.required,
  toolIds: descriptor.toolIds,
  requestedScopes: descriptor.scopes,
  status:
    row?.status ??
    (descriptor.credentialClass === "none" ? "not_required" : "authorization_required"),
  grantedScopes: row ? parseStringList(row.scopes_json) : [],
  tokenExpiresAt: row?.token_expires_at ?? undefined,
  lastUsedAt: row?.last_used_at ?? undefined,
  lastHealthAt: row?.last_health_at ?? undefined,
  lastErrorCode: row?.last_error_code ?? undefined,
  version: row?.version,
});

const activePackConnections = async (env: Env, identity: AgentIdentity) => {
  const agent = await selectAgent(env, identity.agentId, identity.scope.workspaceId);
  if (!agent)
    return { agent: null, pack: null, connections: [] as readonly AgentPackConnectionDescriptor[] };
  const pack = resolveAgentBehaviorConfig(agent).pack;
  return { agent, pack, connections: pack?.connections ?? [] };
};

const selectConnection = (env: Env, identity: AgentIdentity, connectionId: string) =>
  env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id,
            principal, credential_class, status, scopes_json, vault_object_id, vault_version,
            token_expires_at, refresh_lease_owner, refresh_lease_expires_at, last_used_at,
            last_health_at, last_error_code, version, data_json, created_at, updated_at, revoked_at
     FROM control_connections
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND connection_id = ? LIMIT 1`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, connectionId)
    .first<ControlConnectionRow>();

const requireConnectionAdmin = async (env: Env, identity: AgentIdentity) => {
  const membership = await selectMembership(env, identity.scope.userId, identity.scope.workspaceId);
  return requireAdminMembership(membership);
};

const vaultContext = (identity: AgentIdentity) => {
  return { workspaceId: identity.scope.workspaceId };
};

const vaultReference = (row: ControlConnectionRow): VaultObjectReference => {
  if (!row.vault_object_id || !row.vault_version) throw new Error("connection_credentials_missing");
  return { id: row.vault_object_id, version: row.vault_version };
};

const tokenRequest = async (
  env: Env,
  provider: ConnectionProvider,
  parameters: URLSearchParams,
): Promise<StoredCredential> => {
  if (!provider.tokenUrl || !provider.clientId) throw new Error("oauth_provider_incomplete");
  parameters.set("client_id", provider.clientId);
  if (provider.clientSecret) parameters.set("client_secret", provider.clientSecret);
  assertProviderRequest(env, provider, provider.tokenUrl, "POST");
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: parameters.toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || response.status >= 300) throw new Error("oauth_token_exchange_failed");
  const body = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(body) || typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("oauth_token_response_invalid");
  }
  const scopes = typeof body.scope === "string" ? body.scope.split(/[ ,]+/).filter(Boolean) : [];
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(0, body.expires_in)
      : undefined;
  return {
    kind: "oauth2",
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000).toISOString() : undefined,
    scopes,
  };
};

const revokeProviderCredential = async (
  env: Env,
  row: ControlConnectionRow,
  credential: StoredCredential,
) => {
  if (credential.kind !== "oauth2") return true;
  try {
    const provider = requireConnectionProvider(env, row.provider_id);
    if (!provider.revocationUrl) return false;
    const token = credential.refreshToken ?? credential.accessToken;
    if (!token) return false;
    assertProviderRequest(env, provider, provider.revocationUrl, "POST");
    const form = new URLSearchParams({ token });
    if (provider.clientId) form.set("client_id", provider.clientId);
    if (provider.clientSecret) form.set("client_secret", provider.clientSecret);
    const response = await fetch(provider.revocationUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok && response.status < 300;
  } catch {
    return false;
  }
};

export const handleListConnections = async (env: Env, identity: AgentIdentity) => {
  const { pack, connections } = await activePackConnections(env, identity);
  if (!pack) return json({ ok: true, packId: null, connections: [] });
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id,
            principal, credential_class, status, scopes_json, vault_object_id, vault_version,
            token_expires_at, refresh_lease_owner, refresh_lease_expires_at, last_used_at,
            last_health_at, last_error_code, version, data_json, created_at, updated_at, revoked_at
     FROM control_connections
     WHERE user_id = ? AND workspace_id = ? AND agent_id = ? AND pack_id = ?`,
  )
    .bind(identity.scope.userId, identity.scope.workspaceId, identity.agentId, pack.id)
    .all<ControlConnectionRow>();
  const byDescriptor = new Map(rows.results.map((row) => [row.connection_id, row]));
  return json({
    ok: true,
    enabled: connectionsEnabled(env),
    packId: pack.id,
    connections: connections.map((descriptor) =>
      connectionSummary(byDescriptor.get(descriptor.id) ?? null, descriptor),
    ),
  });
};

export const handleStoreConnectionCredential = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  connectionId: string,
) => {
  if (!connectionsEnabled(env))
    return json(
      { ok: false, code: "connections_disabled", error: "Connections are disabled." },
      { status: 503 },
    );
  const adminError = await requireConnectionAdmin(env, identity);
  if (adminError) return adminError;
  const { pack, connections } = await activePackConnections(env, identity);
  const descriptor = connections.find((candidate) => candidate.id === connectionId);
  if (!pack || !descriptor || descriptor.credentialClass === "none") {
    return json({ ok: false, error: "Connection not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (!isRecord(body))
    return json({ ok: false, error: "Invalid credential payload." }, { status: 400 });
  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!secret || secret.length > 16_384)
    return json(
      { ok: false, error: "Credential must be bounded non-empty text." },
      { status: 400 },
    );
  if (descriptor.credentialClass === "oauth2" && env.WORKBENCH_E2E_MODE !== "true") {
    return json(
      {
        ok: false,
        code: "oauth_flow_required",
        error: "OAuth connections must use the authorization flow.",
      },
      { status: 400 },
    );
  }

  const timestamp = new Date().toISOString();
  const existing = await selectConnection(env, identity, connectionId);
  const recordId = existing?.id ?? createId("cf-connection");
  const credential: StoredCredential =
    descriptor.credentialClass === "api_key"
      ? { kind: "api_key", apiKey: secret, scopes: [...descriptor.scopes] }
      : {
          kind: "oauth2",
          accessToken: secret,
          tokenType: "Bearer",
          scopes: [...descriptor.scopes],
        };
  const vault = resolveCredentialVault(env);
  const stored =
    existing?.vault_object_id && existing.vault_version
      ? await vault.replace({ ...vaultReference(existing), value: JSON.stringify(credential) })
      : await vault.create({
          context: vaultContext(identity),
          name: `connection:${recordId}`,
          value: JSON.stringify(credential),
        });
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO control_connections (
         id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id, principal,
         credential_class, status, scopes_json, vault_object_id, vault_version, version,
         data_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'authorized', ?, ?, ?, 1, '{}', ?, ?)
       ON CONFLICT(user_id, workspace_id, agent_id, pack_id, connection_id) DO UPDATE SET
         status = 'authorized', scopes_json = excluded.scopes_json,
         vault_object_id = excluded.vault_object_id, vault_version = excluded.vault_version,
         last_error_code = NULL, revoked_at = NULL, version = control_connections.version + 1,
         updated_at = excluded.updated_at`,
      ).bind(
        recordId,
        identity.scope.userId,
        identity.scope.workspaceId,
        identity.agentId,
        pack.id,
        connectionId,
        descriptor.provider,
        descriptor.principal,
        descriptor.credentialClass,
        toJson(descriptor.scopes),
        stored.id,
        stored.version,
        timestamp,
        timestamp,
      ),
      env.DB.prepare(
        `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) VALUES (?, ?, ?, 'connection.authorized', 'External connection authorized.',
         'connection', ?, ?, ?)`,
      ).bind(
        createId("cf-audit"),
        identity.scope.userId,
        identity.scope.workspaceId,
        recordId,
        toJson({
          packId: pack.id,
          connectionId,
          provider: descriptor.provider,
          scopes: descriptor.scopes,
        }),
        timestamp,
      ),
    ]);
  } catch (error) {
    if (!existing?.vault_object_id) await vault.delete(stored).catch(() => undefined);
    throw error;
  }
  return json(
    { ok: true, connection: { ...connectionSummary(null, descriptor), status: "authorized" } },
    { status: existing ? 200 : 201 },
  );
};

export const handleStartConnectionAuthorization = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
  connectionId: string,
) => {
  if (!connectionsEnabled(env))
    return json(
      { ok: false, code: "connections_disabled", error: "Connections are disabled." },
      { status: 503 },
    );
  const adminError = await requireConnectionAdmin(env, identity);
  if (adminError) return adminError;
  const { pack, connections } = await activePackConnections(env, identity);
  const descriptor = connections.find((candidate) => candidate.id === connectionId);
  if (!pack || !descriptor || descriptor.credentialClass !== "oauth2") {
    return json({ ok: false, error: "OAuth connection not found." }, { status: 404 });
  }
  const provider = requireConnectionProvider(env, descriptor.provider);
  if (!provider.authorizationUrl || !provider.clientId || !provider.tokenUrl) {
    return json(
      {
        ok: false,
        code: "oauth_provider_incomplete",
        error: "OAuth provider is not fully configured.",
      },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => null);
  const redirectUri =
    isRecord(body) && typeof body.redirectUri === "string" ? body.redirectUri : "";
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return json({ ok: false, error: "A valid redirect URI is required." }, { status: 400 });
  }
  if (
    redirect.protocol !== "https:" &&
    !(env.WORKBENCH_E2E_MODE === "true" && redirect.hostname === "localhost")
  ) {
    return json({ ok: false, error: "OAuth redirect URI must use HTTPS." }, { status: 400 });
  }
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(48);
  const challenge = await pkceChallenge(verifier);
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const existing = await selectConnection(env, identity, connectionId);
  const connectionRecordId = existing?.id ?? createId("cf-connection");
  const vault = resolveCredentialVault(env);
  const verifierReference = await vault.create({
    context: vaultContext(identity),
    name: `oauth-pkce:${connectionRecordId}:${crypto.randomUUID()}`,
    value: verifier,
  });
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO control_connections (
           id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id, principal,
           credential_class, status, scopes_json, version, data_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'oauth2', 'authorization_required', ?, 1, '{}', ?, ?)
         ON CONFLICT(user_id, workspace_id, agent_id, pack_id, connection_id) DO UPDATE SET
           status = 'authorization_required', last_error_code = NULL,
           version = control_connections.version + 1, updated_at = excluded.updated_at`,
      ).bind(
        connectionRecordId,
        identity.scope.userId,
        identity.scope.workspaceId,
        identity.agentId,
        pack.id,
        descriptor.id,
        descriptor.provider,
        descriptor.principal,
        toJson(descriptor.scopes),
        timestamp,
        timestamp,
      ),
      env.DB.prepare(
        `INSERT INTO control_connection_oauth_states (
           id, user_id, workspace_id, agent_id, connection_record_id, state_hash,
           pkce_verifier_vault_object_id, pkce_verifier_vault_version, redirect_uri,
           expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        createId("cf-oauth-state"),
        identity.scope.userId,
        identity.scope.workspaceId,
        identity.agentId,
        connectionRecordId,
        await sha256Hex(state),
        verifierReference.id,
        verifierReference.version,
        redirect.toString(),
        expiresAt,
        timestamp,
      ),
    ]);
  } catch (error) {
    await vault.delete(verifierReference).catch(() => undefined);
    throw error;
  }
  const authorizationUrl = new URL(provider.authorizationUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", provider.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirect.toString());
  authorizationUrl.searchParams.set("scope", descriptor.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  return json({ ok: true, authorizationUrl: authorizationUrl.toString(), expiresAt });
};

export const handleCompleteConnectionAuthorization = async (
  request: Request,
  env: Env,
  identity: AgentIdentity,
) => {
  if (!connectionsEnabled(env))
    return json(
      { ok: false, code: "connections_disabled", error: "Connections are disabled." },
      { status: 503 },
    );
  const body = await request.json().catch(() => null);
  const state = isRecord(body) && typeof body.state === "string" ? body.state : "";
  const code = isRecord(body) && typeof body.code === "string" ? body.code : "";
  if (!state || !code)
    return json({ ok: false, error: "OAuth state and code are required." }, { status: 400 });
  const stateHash = await sha256Hex(state);
  const oauthState = await env.DB.prepare(
    `SELECT id, connection_record_id, pkce_verifier_vault_object_id,
            pkce_verifier_vault_version, redirect_uri, expires_at
     FROM control_connection_oauth_states
     WHERE state_hash = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?
       AND used_at IS NULL AND expires_at > ? LIMIT 1`,
  )
    .bind(
      stateHash,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      new Date().toISOString(),
    )
    .first<{
      id: string;
      connection_record_id: string;
      pkce_verifier_vault_object_id: string;
      pkce_verifier_vault_version: string;
      redirect_uri: string;
      expires_at: string;
    }>();
  if (!oauthState)
    return json(
      {
        ok: false,
        code: "oauth_state_invalid",
        error: "OAuth state is invalid, expired, or already used.",
      },
      { status: 409 },
    );
  const claimedAt = new Date().toISOString();
  const claimed = (await env.DB.prepare(
    `UPDATE control_connection_oauth_states SET used_at = ?
     WHERE id = ? AND used_at IS NULL AND expires_at > ?`,
  )
    .bind(claimedAt, oauthState.id, claimedAt)
    .run()) as { meta?: { changes?: number } };
  if ((claimed.meta?.changes ?? 0) === 0)
    return json(
      { ok: false, code: "oauth_state_replayed", error: "OAuth state was already consumed." },
      { status: 409 },
    );
  const connection = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id,
            principal, credential_class, status, scopes_json, vault_object_id, vault_version,
            token_expires_at, refresh_lease_owner, refresh_lease_expires_at, last_used_at,
            last_health_at, last_error_code, version, data_json, created_at, updated_at, revoked_at
     FROM control_connections WHERE id = ? AND user_id = ? AND workspace_id = ? LIMIT 1`,
  )
    .bind(oauthState.connection_record_id, identity.scope.userId, identity.scope.workspaceId)
    .first<ControlConnectionRow>();
  if (!connection) return json({ ok: false, error: "Connection not found." }, { status: 404 });
  const provider = requireConnectionProvider(env, connection.provider_id);
  const vault = resolveCredentialVault(env);
  const verifierReference = {
    id: oauthState.pkce_verifier_vault_object_id,
    version: oauthState.pkce_verifier_vault_version,
  };
  try {
    const verifier = await vault.read(verifierReference);
    const credential = await tokenRequest(
      env,
      provider,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oauthState.redirect_uri,
        code_verifier: verifier.value,
      }),
    );
    const requestedScopes = parseStringList(connection.scopes_json);
    const grantedScopes = credential.scopes.length ? credential.scopes : requestedScopes;
    if (requestedScopes.some((scope) => !grantedScopes.includes(scope)))
      throw new Error("oauth_scope_missing");
    credential.scopes = grantedScopes;
    const credentialReference =
      connection.vault_object_id && connection.vault_version
        ? await vault.replace({ ...vaultReference(connection), value: JSON.stringify(credential) })
        : await vault.create({
            context: vaultContext(identity),
            name: `connection:${connection.id}`,
            value: JSON.stringify(credential),
          });
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE control_connections SET status = 'authorized', scopes_json = ?, vault_object_id = ?,
           vault_version = ?, token_expires_at = ?, last_error_code = NULL, revoked_at = NULL,
           version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ?`,
      ).bind(
        toJson(grantedScopes),
        credentialReference.id,
        credentialReference.version,
        credential.expiresAt ?? null,
        timestamp,
        connection.id,
        identity.scope.userId,
        identity.scope.workspaceId,
      ),
      env.DB.prepare(
        `INSERT INTO control_audit_events (
           id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
         ) VALUES (?, ?, ?, 'connection.authorized', 'OAuth connection authorized.',
           'connection', ?, ?, ?)`,
      ).bind(
        createId("cf-audit"),
        identity.scope.userId,
        identity.scope.workspaceId,
        connection.id,
        toJson({ provider: connection.provider_id, scopes: grantedScopes }),
        timestamp,
      ),
    ]);
    await vault.delete(verifierReference).catch(() => undefined);
    await env.DB.prepare(
      `DELETE FROM control_connection_oauth_states WHERE id = ? AND used_at IS NOT NULL`,
    )
      .bind(oauthState.id)
      .run();
    return json({ ok: true, connectionId: connection.connection_id, status: "authorized" });
  } catch (error) {
    await vault.delete(verifierReference).catch(() => undefined);
    await env.DB.prepare(
      `DELETE FROM control_connection_oauth_states WHERE id = ? AND used_at IS NOT NULL`,
    )
      .bind(oauthState.id)
      .run();
    await env.DB.prepare(
      `UPDATE control_connections SET status = 'unhealthy', last_error_code = ?,
         version = version + 1, updated_at = ? WHERE id = ? AND user_id = ? AND workspace_id = ?`,
    )
      .bind(
        error instanceof Error ? error.message.slice(0, 80) : "oauth_failed",
        new Date().toISOString(),
        connection.id,
        identity.scope.userId,
        identity.scope.workspaceId,
      )
      .run();
    return json(
      { ok: false, code: "oauth_exchange_failed", error: "OAuth authorization failed." },
      { status: 502 },
    );
  }
};

export const expireConnectionOAuthStates = async (env: Env, now = new Date()) => {
  if (!connectionsEnabled(env)) return { expired: 0, failed: 0 };
  const timestamp = now.toISOString();
  await env.DB.prepare(
    `DELETE FROM control_connection_capabilities
     WHERE expires_at <= ? OR consumed_at IS NOT NULL`,
  )
    .bind(timestamp)
    .run();
  const rows = await env.DB.prepare(
    `SELECT id, pkce_verifier_vault_object_id, pkce_verifier_vault_version
     FROM control_connection_oauth_states WHERE expires_at <= ? LIMIT 25`,
  )
    .bind(timestamp)
    .all<{
      id: string;
      pkce_verifier_vault_object_id: string;
      pkce_verifier_vault_version: string;
    }>();
  const vault = resolveCredentialVault(env);
  let expired = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      await vault.delete({
        id: row.pkce_verifier_vault_object_id,
        version: row.pkce_verifier_vault_version,
      });
      await env.DB.prepare(
        "DELETE FROM control_connection_oauth_states WHERE id = ? AND expires_at <= ?",
      )
        .bind(row.id, timestamp)
        .run();
      expired += 1;
    } catch {
      failed += 1;
    }
  }
  return { expired, failed };
};

export const handleRevokeConnection = async (
  env: Env,
  identity: AgentIdentity,
  connectionId: string,
) => {
  const adminError = await requireConnectionAdmin(env, identity);
  if (adminError) return adminError;
  const row = await selectConnection(env, identity, connectionId);
  if (!row) return json({ ok: false, error: "Connection not found." }, { status: 404 });
  let providerRevoked = row.credential_class !== "oauth2";
  if (row.vault_object_id && row.vault_version) {
    const vault = resolveCredentialVault(env);
    const stored = await vault.read(vaultReference(row));
    const credential = JSON.parse(stored.value) as StoredCredential;
    providerRevoked = await revokeProviderCredential(env, row, credential);
    await vault.revoke(vaultReference(row));
  }
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE control_connections SET status = 'revoked', vault_object_id = NULL,
         vault_version = NULL, token_expires_at = NULL, last_error_code = ?,
         revoked_at = ?, version = version + 1,
         updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND status <> 'revoked'`,
    ).bind(
      providerRevoked ? null : "provider_revocation_unconfirmed",
      timestamp,
      timestamp,
      row.id,
      identity.scope.userId,
      identity.scope.workspaceId,
    ),
    env.DB.prepare(
      `INSERT INTO control_audit_events (
         id, user_id, workspace_id, action, summary, target_type, target_id, data_json, created_at
       ) VALUES (?, ?, ?, 'connection.revoked', 'External connection revoked.', 'connection', ?, '{}', ?)`,
    ).bind(
      createId("cf-audit"),
      identity.scope.userId,
      identity.scope.workspaceId,
      row.id,
      timestamp,
    ),
  ]);
  return json({ ok: true, connectionId, status: "revoked", providerRevoked });
};

export const handleRefreshConnection = async (
  env: Env,
  identity: AgentIdentity,
  connectionId: string,
) => {
  const adminError = await requireConnectionAdmin(env, identity);
  if (adminError) return adminError;
  const row = await selectConnection(env, identity, connectionId);
  if (!row) return json({ ok: false, error: "Connection not found." }, { status: 404 });
  if (row.credential_class !== "oauth2" || !row.vault_object_id || !row.vault_version) {
    return json(
      { ok: false, code: "refresh_not_supported", error: "Connection cannot be refreshed." },
      { status: 409 },
    );
  }
  const leaseOwner = createId("cf-refresh");
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 30_000).toISOString();
  const claimed = (await env.DB.prepare(
    `UPDATE control_connections SET refresh_lease_owner = ?, refresh_lease_expires_at = ?,
       version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?
       AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at <= ?)`,
  )
    .bind(
      leaseOwner,
      leaseExpiresAt,
      now.toISOString(),
      row.id,
      identity.scope.userId,
      identity.scope.workspaceId,
      now.toISOString(),
    )
    .run()) as { meta?: { changes?: number } };
  if ((claimed.meta?.changes ?? 0) === 0) {
    return json(
      {
        ok: false,
        code: "refresh_in_progress",
        error: "Connection refresh is already in progress.",
      },
      { status: 409 },
    );
  }
  try {
    const provider = requireConnectionProvider(env, row.provider_id);
    const vault = resolveCredentialVault(env);
    const stored = await vault.read(vaultReference(row));
    const credential = JSON.parse(stored.value) as StoredCredential;
    if (!credential.refreshToken) throw new Error("oauth_refresh_token_missing");
    const refreshed = await tokenRequest(
      env,
      provider,
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
      }),
    );
    if (!refreshed.refreshToken) refreshed.refreshToken = credential.refreshToken;
    if (!refreshed.scopes.length) refreshed.scopes = credential.scopes;
    const reference = await vault.replace({
      ...vaultReference(row),
      value: JSON.stringify(refreshed),
    });
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE control_connections SET status = 'authorized', scopes_json = ?, vault_version = ?,
         token_expires_at = ?, refresh_lease_owner = NULL, refresh_lease_expires_at = NULL,
         last_error_code = NULL, version = version + 1, updated_at = ?
       WHERE id = ? AND user_id = ? AND workspace_id = ? AND refresh_lease_owner = ?`,
    )
      .bind(
        toJson(refreshed.scopes),
        reference.version,
        refreshed.expiresAt ?? null,
        timestamp,
        row.id,
        identity.scope.userId,
        identity.scope.workspaceId,
        leaseOwner,
      )
      .run();
    return json({
      ok: true,
      connectionId,
      status: "authorized",
      tokenExpiresAt: refreshed.expiresAt,
    });
  } catch {
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE control_connections SET status = 'refresh_required', refresh_lease_owner = NULL,
           refresh_lease_expires_at = NULL, last_error_code = 'connection_refresh_failed',
           version = version + 1, updated_at = ?
         WHERE id = ? AND user_id = ? AND workspace_id = ? AND refresh_lease_owner = ?`,
      ).bind(timestamp, row.id, identity.scope.userId, identity.scope.workspaceId, leaseOwner),
      prepareOperatorAlertStatement(env, {
        userId: identity.scope.userId,
        workspaceId: identity.scope.workspaceId,
        agentId: identity.agentId,
        severity: "warning",
        code: "connection_refresh_failed",
        summary: "An OAuth connection refresh failed and requires attention.",
        targetType: "connection",
        targetId: row.id,
        dedupKey: `connection-refresh:${row.id}:${row.version}`,
        data: { connectionId: row.connection_id, provider: row.provider_id },
        timestamp,
      }),
    ]);
    return json(
      { ok: false, code: "connection_refresh_failed", error: "Connection refresh failed." },
      { status: 502 },
    );
  }
};

export const handleConnectionHealth = async (
  env: Env,
  identity: AgentIdentity,
  connectionId: string,
) => {
  const row = await selectConnection(env, identity, connectionId);
  if (!row) return json({ ok: false, error: "Connection not found." }, { status: 404 });
  const timestamp = new Date().toISOString();
  const expired = Boolean(row.token_expires_at && row.token_expires_at <= timestamp);
  const status = row.status === "authorized" && expired ? "refresh_required" : row.status;
  await env.DB.prepare(
    `UPDATE control_connections SET status = ?, last_health_at = ?,
       last_error_code = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND user_id = ? AND workspace_id = ?`,
  )
    .bind(
      status,
      timestamp,
      expired ? "token_expired" : null,
      timestamp,
      row.id,
      identity.scope.userId,
      identity.scope.workspaceId,
    )
    .run();
  return json({ ok: status === "authorized", connectionId, status, checkedAt: timestamp });
};

export const revokeWorkspaceConnections = async (env: Env, identity: AgentIdentity) => {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, workspace_id, agent_id, pack_id, connection_id, provider_id,
            principal, credential_class, status, scopes_json, vault_object_id, vault_version,
            token_expires_at, refresh_lease_owner, refresh_lease_expires_at, last_used_at,
            last_health_at, last_error_code, version, data_json, created_at, updated_at, revoked_at
     FROM control_connections WHERE workspace_id = ? AND status <> 'revoked'`,
  )
    .bind(identity.scope.workspaceId)
    .all<ControlConnectionRow>();
  const oauthStates = await env.DB.prepare(
    `SELECT id, pkce_verifier_vault_object_id, pkce_verifier_vault_version
     FROM control_connection_oauth_states WHERE workspace_id = ?`,
  )
    .bind(identity.scope.workspaceId)
    .all<{
      id: string;
      pkce_verifier_vault_object_id: string;
      pkce_verifier_vault_version: string;
    }>();
  const vault = resolveCredentialVault(env);
  let revoked = 0;
  let failed = 0;
  for (const row of rows.results) {
    if (row.vault_object_id && row.vault_version) {
      try {
        const stored = await vault.read(vaultReference(row));
        const providerRevoked = await revokeProviderCredential(
          env,
          row,
          JSON.parse(stored.value) as StoredCredential,
        ).catch(() => false);
        await vault.revoke(vaultReference(row));
        const timestamp = new Date().toISOString();
        await env.DB.prepare(
          `UPDATE control_connections SET status = 'revoked', vault_object_id = NULL,
             vault_version = NULL, token_expires_at = NULL, last_error_code = ?, revoked_at = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND workspace_id = ?`,
        )
          .bind(
            providerRevoked ? null : "provider_revocation_unconfirmed",
            timestamp,
            timestamp,
            row.id,
            identity.scope.workspaceId,
          )
          .run();
        revoked += 1;
      } catch {
        failed += 1;
      }
    } else {
      const timestamp = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE control_connections SET status = 'revoked', token_expires_at = NULL,
           revoked_at = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND workspace_id = ?`,
      )
        .bind(timestamp, timestamp, row.id, identity.scope.workspaceId)
        .run();
      revoked += 1;
    }
  }
  for (const state of oauthStates.results) {
    try {
      await vault.delete({
        id: state.pkce_verifier_vault_object_id,
        version: state.pkce_verifier_vault_version,
      });
      await env.DB.prepare(
        "DELETE FROM control_connection_oauth_states WHERE id = ? AND workspace_id = ?",
      )
        .bind(state.id, identity.scope.workspaceId)
        .run();
    } catch {
      failed += 1;
    }
  }
  await env.DB.prepare("DELETE FROM control_connection_capabilities WHERE workspace_id = ?")
    .bind(identity.scope.workspaceId)
    .run();
  return { inspected: rows.results.length + oauthStates.results.length, revoked, failed };
};

export const createBrokeredConnectionPort = (
  env: Env,
  identity: AgentIdentity,
  descriptors: readonly AgentPackConnectionDescriptor[],
): ConnectionPort => ({
  async resolve(connectionId, toolId): Promise<ConnectionCapability> {
    const descriptor = descriptors.find(
      (candidate) => candidate.id === connectionId && candidate.toolIds.includes(toolId),
    );
    if (!descriptor || descriptor.credentialClass === "none") {
      return {
        id: connectionId,
        status: "not_required",
        reason: `${toolId} does not require an external connection.`,
      };
    }
    if (!connectionsEnabled(env)) {
      return {
        id: connectionId,
        status: "authorization_required",
        reason: "Connection brokerage is disabled.",
      };
    }
    const row = await selectConnection(env, identity, connectionId);
    if (!row || row.status !== "authorized") {
      return {
        id: connectionId,
        status:
          row?.status === "revoked"
            ? "authorization_required"
            : (row?.status ?? "authorization_required"),
        reason: `${connectionId} is not authorized.`,
      };
    }
    return {
      id: connectionId,
      status: "authorized",
      reason: `${connectionId} is authorized through the platform broker.`,
      request: async (input) => {
        const provider = requireConnectionProvider(env, row.provider_id);
        const requestedUrl = input.url === "broker://configured" ? provider.actionUrl : input.url;
        if (!requestedUrl) throw new Error("connection_action_endpoint_not_configured");
        const request = assertProviderRequest(env, provider, requestedUrl, input.method);
        const credential = await readConnectionCredentialForBroker(env, identity, connectionId);
        const headers = new Headers(input.headers);
        headers.delete("authorization");
        headers.delete("x-api-key");
        if (credential.kind === "api_key") {
          if (provider.credentialPlacement === "x-api-key")
            headers.set("x-api-key", credential.apiKey ?? "");
          else headers.set("authorization", `Bearer ${credential.apiKey ?? ""}`);
        } else {
          headers.set(
            "authorization",
            `${credential.tokenType ?? "Bearer"} ${credential.accessToken ?? ""}`,
          );
        }
        const response = await fetch(request.url, {
          method: request.method,
          headers,
          body: request.method === "GET" ? undefined : input.body,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status >= 300 && response.status < 400)
          throw new Error("provider_redirect_forbidden");
        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > 128 * 1024)
          throw new Error("provider_response_too_large");
        await env.DB.prepare(
          `UPDATE control_connections SET last_used_at = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND user_id = ? AND workspace_id = ? AND status = 'authorized'`,
        )
          .bind(
            new Date().toISOString(),
            new Date().toISOString(),
            row.id,
            identity.scope.userId,
            identity.scope.workspaceId,
          )
          .run();
        return {
          status: response.status,
          headers: Object.fromEntries(
            [...response.headers.entries()].filter(([name]) =>
              ["content-type", "content-length", "etag", "last-modified"].includes(
                name.toLowerCase(),
              ),
            ),
          ),
          body,
        };
      },
    };
  },
});

export const issueFlyConnectionCapability = async (
  env: Env,
  identity: AgentIdentity,
  input: {
    connectionRecordId: string;
    connectionId: string;
    runId: string;
    workflowIntentId: string;
    toolCallId: string;
    toolId: string;
    timeoutMs: number;
  },
): Promise<FlyConnectionCapabilityEnvelope> => {
  const callbackUrl = env.WORKBENCH_CALLBACK_URL?.trim();
  if (!callbackUrl) throw new Error("connection_broker_url_not_configured");
  const row = await env.DB.prepare(
    `SELECT provider_id, status FROM control_connections
     WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?
       AND connection_id = ? LIMIT 1`,
  )
    .bind(
      input.connectionRecordId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.connectionId,
    )
    .first<{ provider_id: string; status: string }>();
  if (!row || row.status !== "authorized") throw new Error("connection_not_authorized");
  const provider = requireConnectionProvider(env, row.provider_id);
  if (!provider.actionUrl) throw new Error("connection_action_endpoint_not_configured");
  const request = assertProviderRequest(env, provider, provider.actionUrl, "POST");
  const token = randomBase64Url(32);
  const tokenSha256 = await sha256Hex(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + Math.max(5_000, Math.min(60_000, input.timeoutMs + 5_000)),
  ).toISOString();
  const inserted = (await env.DB.prepare(
    `INSERT INTO control_connection_capabilities (
       id, token_sha256, user_id, workspace_id, agent_id, connection_record_id,
       run_id, workflow_intent_id, tool_call_id, tool_id, allowed_url, allowed_method,
       expires_at, created_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM control_runs
         WHERE id = ? AND user_id = ? AND workspace_id = ? AND agent_id = ?
           AND status = 'running'
       )`,
  )
    .bind(
      createId("cf-connection-capability"),
      tokenSha256,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
      input.connectionRecordId,
      input.runId,
      input.workflowIntentId,
      input.toolCallId,
      input.toolId,
      request.url.toString(),
      request.method,
      expiresAt,
      createdAt,
      input.runId,
      identity.scope.userId,
      identity.scope.workspaceId,
      identity.agentId,
    )
    .run()) as { meta?: { changes?: number } };
  if ((inserted.meta?.changes ?? 0) !== 1) {
    throw new Error("connection_capability_publication_revoked");
  }
  const origin = new URL(callbackUrl).origin;
  return {
    url: `${origin}/workbench/connection-capabilities/redeem`,
    token,
    connectionId: input.connectionId,
    allowedUrl: request.url.toString(),
    allowedMethod: request.method,
    expiresAt,
  };
};

export const handleRedeemConnectionCapability = async (request: Request, env: Env) => {
  if (!connectionsEnabled(env)) {
    return json(
      { ok: false, code: "connections_disabled", error: "Connection brokerage is disabled." },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || token.length > 256) {
    return json(
      { ok: false, code: "capability_required", error: "A broker capability is required." },
      { status: 401 },
    );
  }
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.url !== "string") {
    return json(
      { ok: false, code: "capability_request_invalid", error: "The broker request is invalid." },
      { status: 400 },
    );
  }
  const method = typeof body.method === "string" ? body.method.toUpperCase() : "GET";
  const tokenSha256 = await sha256Hex(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT c.id AS capability_id, c.user_id, c.workspace_id, c.agent_id,
            c.connection_record_id, c.run_id, c.workflow_intent_id, c.tool_call_id,
            c.tool_id, c.allowed_url, c.allowed_method,
            x.id, x.provider_id, x.status, x.vault_object_id, x.vault_version
     FROM control_connection_capabilities c
     JOIN control_connections x ON x.id = c.connection_record_id
     JOIN control_runs r ON r.id = c.run_id
     WHERE c.token_sha256 = ? AND c.consumed_at IS NULL AND c.expires_at > ?
       AND x.status = 'authorized' AND r.status = 'running'
       AND r.user_id = c.user_id AND r.workspace_id = c.workspace_id
     LIMIT 1`,
  )
    .bind(tokenSha256, now)
    .first<{
      capability_id: string;
      user_id: string;
      workspace_id: string;
      agent_id: string;
      connection_record_id: string;
      run_id: string;
      workflow_intent_id: string;
      tool_call_id: string;
      tool_id: string;
      allowed_url: string;
      allowed_method: string;
      provider_id: string;
      status: string;
      vault_object_id: string | null;
      vault_version: string | null;
    }>();
  if (!row || body.url !== row.allowed_url || method !== row.allowed_method) {
    return json(
      {
        ok: false,
        code: "capability_invalid",
        error: "The broker capability is invalid, expired, or out of scope.",
      },
      { status: 403 },
    );
  }
  const claimed = (await env.DB.prepare(
    `UPDATE control_connection_capabilities SET consumed_at = ?
     WHERE id = ? AND token_sha256 = ? AND consumed_at IS NULL AND expires_at > ?`,
  )
    .bind(now, row.capability_id, tokenSha256, now)
    .run()) as { meta?: { changes?: number } };
  if ((claimed.meta?.changes ?? 0) !== 1) {
    return json(
      {
        ok: false,
        code: "capability_replayed",
        error: "The broker capability was already consumed.",
      },
      { status: 409 },
    );
  }
  try {
    if (!row.vault_object_id || !row.vault_version)
      throw new Error("connection_credentials_missing");
    const provider = requireConnectionProvider(env, row.provider_id);
    const providerRequest = assertProviderRequest(env, provider, row.allowed_url, method);
    const stored = await resolveCredentialVault(env).read({
      id: row.vault_object_id,
      version: row.vault_version,
    });
    const credential = JSON.parse(stored.value) as StoredCredential;
    const headers = new Headers(
      isRecord(body.headers) ? (body.headers as Record<string, string>) : undefined,
    );
    headers.delete("authorization");
    headers.delete("x-api-key");
    if (credential.kind === "api_key") {
      if (provider.credentialPlacement === "x-api-key")
        headers.set("x-api-key", credential.apiKey ?? "");
      else headers.set("authorization", `Bearer ${credential.apiKey ?? ""}`);
    } else {
      headers.set(
        "authorization",
        `${credential.tokenType ?? "Bearer"} ${credential.accessToken ?? ""}`,
      );
    }
    const response = await fetch(providerRequest.url, {
      method: providerRequest.method,
      headers,
      body:
        providerRequest.method === "GET"
          ? undefined
          : typeof body.body === "string"
            ? body.body
            : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("provider_redirect_forbidden");
    const responseBody = await response.text();
    if (new TextEncoder().encode(responseBody).byteLength > 128 * 1024)
      throw new Error("provider_response_too_large");
    await env.DB.prepare(
      `UPDATE control_connections SET last_used_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'authorized'`,
    )
      .bind(now, now, row.connection_record_id)
      .run();
    return json({
      ok: true,
      response: {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers.entries()].filter(([name]) =>
            ["content-type", "content-length", "etag", "last-modified"].includes(
              name.toLowerCase(),
            ),
          ),
        ),
        body: responseBody,
      },
    });
  } catch {
    return json(
      { ok: false, code: "broker_request_failed", error: "The brokered provider request failed." },
      { status: 502 },
    );
  }
};

export const readConnectionCredentialForBroker = async (
  env: Env,
  identity: AgentIdentity,
  connectionId: string,
): Promise<StoredCredential> => {
  const row = await selectConnection(env, identity, connectionId);
  if (!row || row.status !== "authorized") throw new Error("connection_not_authorized");
  const stored = await resolveCredentialVault(env).read(vaultReference(row));
  const credential = JSON.parse(stored.value) as unknown;
  if (!isRecord(credential) || (credential.kind !== "api_key" && credential.kind !== "oauth2")) {
    throw new Error("connection_credential_invalid");
  }
  return credential as StoredCredential;
};

export const connectionSecretFingerprint = sha256Hex;
