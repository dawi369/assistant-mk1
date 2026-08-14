import { describe, expect, it } from "vitest";

import { schemaFormDefaults, schemaFormInput } from "./schema-form-model";

const schema = {
  type: "object",
  required: ["mode", "limit"],
  properties: {
    mode: { type: "string", enum: ["fast", "deep"], default: "fast" },
    limit: { type: "integer", minimum: 1, maximum: 10 },
    options: { type: "object", title: "Options" },
    enabled: { type: "boolean", default: false },
  },
};

describe("generic workflow form model", () => {
  it("hydrates defaults and converts typed values", () => {
    expect(schemaFormDefaults(schema)).toEqual({ mode: "fast", enabled: false });
    expect(
      schemaFormInput(schema, {
        mode: "deep",
        limit: "4",
        options: '{"trace":true}',
        enabled: false,
      }),
    ).toEqual({ mode: "deep", limit: 4, options: { trace: true }, enabled: false });
  });

  it("rejects missing, bounded, and invalid JSON fields before dispatch", () => {
    expect(() => schemaFormInput(schema, { mode: "fast" })).toThrow("limit is required");
    expect(() => schemaFormInput(schema, { mode: "fast", limit: "20" })).toThrow("at most 10");
    expect(() => schemaFormInput(schema, { mode: "fast", limit: "2", options: "{" })).toThrow(
      "Options must contain valid JSON",
    );
  });
});
