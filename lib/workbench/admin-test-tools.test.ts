import { describe, expect, it } from "vitest";

import {
  validateArtifactMetadataTestInput,
  validateDiagnosticPingInput,
  validateRunnerEchoInput,
} from "./admin-test-tools";

describe("admin conformance test tool input contracts", () => {
  it("accepts bounded diagnostic ping input", () => {
    expect(validateDiagnosticPingInput(undefined)).toEqual({});
    expect(validateDiagnosticPingInput({ label: "  policy path  " })).toEqual({
      label: "policy path",
    });
  });

  it("accepts bounded runner echo input", () => {
    expect(validateRunnerEchoInput(undefined)).toEqual({
      message: "runner echo ok",
      uppercase: false,
    });
    expect(validateRunnerEchoInput({ message: " hello ", uppercase: true })).toEqual({
      message: "hello",
      uppercase: true,
    });
  });

  it("accepts bounded artifact metadata input", () => {
    expect(validateArtifactMetadataTestInput(null)).toEqual({});
    expect(validateArtifactMetadataTestInput({ label: " artifact history " })).toEqual({
      label: "artifact history",
    });
  });

  it("rejects arbitrary command, path, url, log, and secret fields", () => {
    for (const invalid of [
      { command: "echo hi" },
      { path: "/tmp/file" },
      { url: "https://example.com" },
      { logs: "raw output" },
      { token: "secret" },
    ]) {
      expect(validateRunnerEchoInput(invalid)).toMatchObject({
        code: "invalid_input",
        redacted: true,
      });
    }
  });

  it("rejects oversized or incorrectly typed options", () => {
    expect(validateDiagnosticPingInput({ label: "x".repeat(81) })).toMatchObject({
      code: "invalid_input",
      redacted: true,
    });
    expect(validateRunnerEchoInput({ message: "x".repeat(161) })).toMatchObject({
      code: "invalid_input",
      redacted: true,
    });
    expect(validateRunnerEchoInput({ uppercase: "true" })).toMatchObject({
      code: "invalid_input",
      redacted: true,
    });
  });
});
