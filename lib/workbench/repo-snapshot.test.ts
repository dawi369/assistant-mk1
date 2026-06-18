import { describe, expect, it } from "vitest";

import { repoSnapshotError, validateRepoSnapshotInput } from "./repo-snapshot";

describe("repo.snapshot input contract", () => {
  it("defaults to a bounded read-only snapshot", () => {
    expect(validateRepoSnapshotInput(undefined)).toEqual({});
    expect(validateRepoSnapshotInput(null)).toEqual({});
  });

  it("accepts only explicit boolean options", () => {
    expect(
      validateRepoSnapshotInput({
        includeDocs: true,
        includeScripts: false,
        includeConfig: true,
      }),
    ).toEqual({
      includeDocs: true,
      includeScripts: false,
      includeConfig: true,
    });

    expect(validateRepoSnapshotInput({ command: "git status" })).toMatchObject({
      code: "invalid_input",
      redacted: true,
    });
    expect(validateRepoSnapshotInput({ includeDocs: "true" })).toMatchObject({
      code: "invalid_input",
      redacted: true,
    });
  });

  it("returns redacted typed errors", () => {
    expect(repoSnapshotError("repo_snapshot_failed", "failed: /Users/private/token", true)).toEqual(
      {
        code: "repo_snapshot_failed",
        message: "failed: /Users/private/token",
        retryable: true,
        redacted: true,
      },
    );
  });
});
