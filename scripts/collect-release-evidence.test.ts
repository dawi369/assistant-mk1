import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release evidence collector", () => {
  it("binds evidence to one target and full commit without credential values", () => {
    const source = readFileSync("scripts/collect-release-evidence.ts", "utf8");
    expect(source).toContain("parsed.commit !== commit || parsed.target !== target");
    expect(source).toContain("credential-shaped value");
    expect(source).toContain("environmentManifestSha256");
    expect(source).toContain('"hosted.soak-24h"');
    expect(source).toContain('"hosted.alert-outage-redelivery"');
    expect(source).toContain("requiredPromotionStages");
    expect(source).toContain("latestByKind");
  });
});
