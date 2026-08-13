import { describe, expect, it } from "vitest";

import {
  connectionSummary,
  parseStringList,
  pkceChallenge,
  randomBase64Url,
  sha256Hex,
  vaultReference,
} from "./connection-broker-shared";
import type { ControlConnectionRow } from "./types";

const descriptor = {
  id: "provider.primary",
  provider: "synthetic",
  principal: "user",
  credentialClass: "api_key",
  custody: "external_broker",
  required: true,
  toolIds: ["operator.inspect"],
  scopes: ["read"],
} as const;

describe("connection broker primitives", () => {
  it("parses only string scopes and fails closed on malformed JSON", () => {
    expect(parseStringList('["read", 7, "write"]')).toEqual(["read", "write"]);
    expect(parseStringList("not-json")).toEqual([]);
  });

  it("summarizes connection metadata without credential references", () => {
    const row = {
      status: "authorized",
      scopes_json: '["read"]',
      token_expires_at: "2030-01-01T00:00:00.000Z",
      last_used_at: null,
      last_health_at: null,
      last_error_code: null,
      version: 3,
      vault_object_id: "vault-secret-reference",
      vault_version: "secret-version",
    } as ControlConnectionRow;
    const summary = connectionSummary(row, descriptor);
    expect(summary).toMatchObject({ id: descriptor.id, status: "authorized", version: 3 });
    expect(JSON.stringify(summary)).not.toContain("vault-secret-reference");
    expect(JSON.stringify(summary)).not.toContain("secret-version");
  });

  it("requires complete Vault references", () => {
    expect(() => vaultReference({ vault_object_id: null } as ControlConnectionRow)).toThrow(
      "connection_credentials_missing",
    );
  });

  it("uses bounded URL-safe entropy and deterministic SHA-256 fingerprints", async () => {
    const token = randomBase64Url(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(sha256Hex("connection-secret-sentinel")).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(pkceChallenge("verifier")).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
