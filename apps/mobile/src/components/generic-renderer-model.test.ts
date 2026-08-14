import { describe, expect, it } from "vitest";

import {
  artifactPayload,
  artifactRendererKind,
  boundedDisplayJson,
  tableRows,
} from "./generic-renderer-model";

describe("generic native renderer model", () => {
  it("honors trusted pack descriptors and falls back by MIME type", () => {
    const artifact = { id: "artifact-1", kind: "report", mimeType: "application/json" };
    expect(
      artifactRendererKind(artifact, {
        artifactKind: "report",
        renderer: "table",
        title: "Report",
        version: 1,
      }),
    ).toBe("table");
    expect(artifactRendererKind({ ...artifact, mimeType: "text/markdown" })).toBe("markdown");
    expect(artifactRendererKind(artifact)).toBe("json");
  });

  it("extracts common payloads and tolerates unknown structured artifacts", () => {
    expect(artifactPayload({ report: { status: "ready" } })).toEqual({ status: "ready" });
    expect(artifactPayload({ future: true })).toEqual({ future: true });
    expect(artifactPayload(undefined)).toBeNull();
  });

  it("normalizes bounded table rows and display output", () => {
    expect(tableRows({ rows: [{ name: "one" }, null, "invalid"] })).toEqual([{ name: "one" }]);
    expect(boundedDisplayJson({ secret: "redacted" }, 8)).toMatch(/…$/);
  });
});
