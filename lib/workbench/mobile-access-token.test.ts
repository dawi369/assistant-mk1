import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import { describe, expect, it } from "vitest";

import { WorkbenchAuthError } from "./agent-identity-types";
import { resolveWorkbenchAgentIdentity } from "./agent-identity-resolution";
import {
  loadMobileAccessTokenConfig,
  parseAuthoritativeBearer,
  verifyWorkbenchMobileAccessToken,
  type MobileAccessTokenConfig,
} from "./mobile-access-token";

const config = (overrides: Partial<MobileAccessTokenConfig> = {}): MobileAccessTokenConfig => ({
  allowedClientIds: new Set(["client_mobile"]),
  enabled: true,
  issuer: "https://auth.example",
  jwksUrl: "https://auth.example/oauth2/jwks",
  production: false,
  ...overrides,
});

const signedToken = async (
  privateKey: KeyLike | Uint8Array,
  claims: Record<string, unknown> = {},
) =>
  new SignJWT({ client_id: "client_mobile", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://auth.example")
    .setSubject("user_mobile")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

describe("mobile WorkOS access token", () => {
  it("maps an allowed organization token to the cookie-equivalent tenant identity", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const token = await signedToken(privateKey, {
      org_id: "org_mobile",
      permissions: ["workbench:read"],
      role: "member",
    });

    await expect(verifyWorkbenchMobileAccessToken(token, config(), publicKey)).resolves.toEqual(
      expect.objectContaining({
        accountId: "workos-org:org_mobile",
        accountSource: "workos-organization",
        authMode: "workos",
        membershipPermissions: ["workbench:read"],
        membershipRole: "member",
        organizationId: "org_mobile",
        scope: {
          userId: "user_mobile",
          workspaceId: "workspace:workos-org:org_mobile:default",
        },
      }),
    );
  });

  it("accepts an allowed OAuth audience when client_id is absent", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://auth.example")
      .setAudience("client_mobile")
      .setSubject("user_mobile")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifyWorkbenchMobileAccessToken(token, config(), publicKey)).resolves.toEqual(
      expect.objectContaining({ accountId: "workos-personal:user_mobile" }),
    );
  });

  it("rejects an unapproved client even when its signature is valid", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const token = await signedToken(privateKey, { client_id: "client_unapproved" });

    await expect(
      verifyWorkbenchMobileAccessToken(token, config(), publicKey),
    ).rejects.toMatchObject({ name: "WorkbenchAuthError", status: 401 });
  });

  it("treats every present Authorization header as authoritative", () => {
    expect(parseAuthoritativeBearer(null)).toBeNull();
    expect(parseAuthoritativeBearer("Bearer token-value")).toBe("token-value");
    expect(() => parseAuthoritativeBearer("Basic cookie-fallback")).toThrow(WorkbenchAuthError);
    expect(() => parseAuthoritativeBearer("Bearer ")).toThrow(WorkbenchAuthError);
  });

  it("never falls back to cookie identity after an invalid bearer", async () => {
    let cookieCalls = 0;
    await expect(
      resolveWorkbenchAgentIdentity({
        authorization: "Bearer invalid",
        cookieIdentity: async () => {
          cookieCalls += 1;
          throw new Error("cookie identity must not run");
        },
        mobileConfig: config(),
        mobileKey: async () => {
          throw new Error("invalid signature");
        },
      }),
    ).rejects.toMatchObject({ name: "WorkbenchAuthError", status: 401 });
    expect(cookieCalls).toBe(0);
  });

  it("rejects insecure production verification configuration", () => {
    expect(() =>
      loadMobileAccessTokenConfig({
        NODE_ENV: "production",
        WORKBENCH_MOBILE_CLIENTS_ENABLED: "true",
        WORKBENCH_WORKOS_ALLOWED_CLIENT_IDS: "client_mobile",
        WORKBENCH_WORKOS_ISSUER: "http://localhost:9000",
        WORKBENCH_WORKOS_JWKS_URL: "http://localhost:9000/jwks",
      }),
    ).toThrow("requires HTTPS");
  });

  it("keeps production mobile identity disabled without requiring dormant configuration", () => {
    expect(loadMobileAccessTokenConfig({ NODE_ENV: "production" })).toEqual(
      expect.objectContaining({ enabled: false, production: true }),
    );
  });
});
