import { describe, expect, it } from "vitest";

import {
  describeProvisionCommandFailure,
  provisionResourceExists,
} from "./provision-environment-core";

describe("environment provisioning helpers", () => {
  it("recognizes exact provider resources without prefix collisions", () => {
    expect(
      provisionResourceExists(
        "cloudflare-d1",
        '[{"name":"assistant_mk1_acceptance"}]',
        "assistant_mk1_acceptance",
      ),
    ).toBe(true);
    expect(
      provisionResourceExists(
        "cloudflare-queue",
        "assistant-mk1-production-control-plane-notifications\n",
        "assistant-mk1-production-control-plane-notifications",
      ),
    ).toBe(true);
    expect(
      provisionResourceExists(
        "cloudflare-r2",
        "name: assistant-mk1-acceptance-artifacts-old\n",
        "assistant-mk1-acceptance-artifacts",
      ),
    ).toBe(false);
    expect(
      provisionResourceExists(
        "fly-app",
        '[{"Name":"assistant-mk1-acceptance-runner"}]',
        "assistant-mk1-acceptance-runner",
      ),
    ).toBe(true);
    expect(
      provisionResourceExists(
        "vercel-project",
        "  assistant-mk1-acceptance   https://example.invalid\n",
        "assistant-mk1-acceptance",
      ),
    ).toBe(true);
  });

  it("keeps provider failures bounded and actionable", () => {
    const message = describeProvisionCommandFailure({
      command: "vercel",
      args: ["project", "add", "assistant-mk1-acceptance", "--non-interactive"],
      status: 1,
      stdout: "",
      stderr: `unsupported option ${"x".repeat(600)}`,
    });
    expect(message).toContain("vercel project add assistant-mk1-acceptance --non-interactive");
    expect(message.length).toBeLessThan(600);
  });
});
