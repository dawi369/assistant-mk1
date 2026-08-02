import { describe, expect, it } from "vitest";

import { releaseEvidenceCommand } from "./release-evidence-args";

describe("release evidence command parsing", () => {
  it("uses the explicit command separator after pnpm's forwarding sentinel", () => {
    expect(
      releaseEvidenceCommand([
        "node",
        "run-release-evidence.ts",
        "--",
        "--target",
        "acceptance",
        "--kind",
        "hosted.public",
        "--",
        "pnpm",
        "acceptance:hosted:public",
      ]),
    ).toEqual(["pnpm", "acceptance:hosted:public"]);
  });

  it("returns no command when the separator is absent", () => {
    expect(releaseEvidenceCommand(["node", "run-release-evidence.ts"])).toEqual([]);
  });
});
