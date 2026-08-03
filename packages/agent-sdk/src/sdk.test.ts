import { describe, expect, it } from "vitest";

import {
  assertSchemaDefinition,
  assertSchemaValue,
  defaultActionPort,
  defaultConnectionPort,
  isPackVersionCompatible,
  isWorkbenchVersionCompatible,
  parseSemanticVersion,
  validateSchemaValue,
} from "./index.js";

describe("Agent Runtime SDK", () => {
  it("resolves supported compatibility ranges", () => {
    expect(isPackVersionCompatible("1.2.3", "^1.2.0")).toBe(true);
    expect(isPackVersionCompatible("2.0.0", "^1.2.0")).toBe(false);
    expect(isPackVersionCompatible("1.4.0", ">=1.2.0 <2.0.0")).toBe(true);
    expect(isPackVersionCompatible("invalid", "*")).toBe(false);
  });

  it("resolves exact, minimum-only, and bounded workbench versions", () => {
    expect(isWorkbenchVersionCompatible("1.0.0", "1.0.0")).toBe(true);
    expect(isWorkbenchVersionCompatible("1.0.0", "0.9.0")).toBe(true);
    expect(isWorkbenchVersionCompatible("1.0.0", "0.9.0", "1.0.0")).toBe(true);
    expect(isWorkbenchVersionCompatible("1.0.0", "1.1.0")).toBe(false);
    expect(isWorkbenchVersionCompatible("1.0.0", "0.9.0", "0.9.9")).toBe(false);
    expect(isWorkbenchVersionCompatible("1.0.0", "invalid")).toBe(false);
  });

  it("implements semantic-version prerelease precedence and ignores build metadata", () => {
    expect(isWorkbenchVersionCompatible("1.0.0-preview.1", "1.0.0")).toBe(false);
    expect(isWorkbenchVersionCompatible("1.0.0", "1.0.0-preview.1")).toBe(true);
    expect(isWorkbenchVersionCompatible("1.0.0-preview.2", "1.0.0-preview.10")).toBe(false);
    expect(isWorkbenchVersionCompatible("1.0.0-preview.10", "1.0.0-preview.2")).toBe(true);
    expect(isWorkbenchVersionCompatible("1.0.0-1", "1.0.0-alpha")).toBe(false);
    expect(isWorkbenchVersionCompatible("1.0.0-alpha.1", "1.0.0-alpha")).toBe(true);
    expect(isWorkbenchVersionCompatible("1.0.0+build.2", "1.0.0+build.1", "1.0.0")).toBe(true);
  });

  it("rejects malformed semantic versions", () => {
    expect(parseSemanticVersion("01.0.0")).toBeNull();
    expect(parseSemanticVersion("1.01.0")).toBeNull();
    expect(parseSemanticVersion("1.0.01")).toBeNull();
    expect(parseSemanticVersion("1.0.0-preview.01")).toBeNull();
    expect(parseSemanticVersion("1.0.0-preview..1")).toBeNull();
    expect(parseSemanticVersion("1.0.0+")).toBeNull();
  });

  it("validates bounded object schemas", () => {
    const schema = {
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: { name: { type: "string", minLength: 2, maxLength: 4 } },
    } as const;
    expect(validateSchemaValue(schema, { name: "ok" })).toEqual([]);
    expect(validateSchemaValue(schema, { name: "x", extra: true })).toHaveLength(2);
    expect(() => assertSchemaValue(schema, {}, "fixture")).toThrow(
      "fixture failed schema validation",
    );
  });

  it("rejects malformed or unsupported schema definitions", () => {
    expect(() =>
      assertSchemaDefinition(
        {
          type: "object",
          properties: { count: { type: "imaginary" } },
        },
        "fixture",
      ),
    ).toThrow("fixture is not a supported JSON Schema");
    expect(() => assertSchemaDefinition({ type: "string", pattern: "[" }, "fixture")).toThrow(
      "valid regular expression",
    );
  });

  it("defaults brokered connections to authorization-required and disables actions", async () => {
    const connections = defaultConnectionPort([
      {
        id: "broker",
        provider: "fixture",
        principal: "user",
        credentialClass: "oauth2",
        custody: "external_broker",
        required: false,
        toolIds: ["fixture.read"],
        scopes: ["read"],
      },
    ]);
    await expect(connections.resolve("broker", "fixture.read")).resolves.toMatchObject({
      status: "authorization_required",
    });
    await expect(defaultActionPort.execute("proposal")).rejects.toMatchObject({
      code: "mutation_disabled",
    });
  });
});
