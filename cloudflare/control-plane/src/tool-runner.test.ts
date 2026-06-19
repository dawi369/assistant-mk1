import { describe, expect, it } from "vitest";

import {
  repoSnapshotSandboxContract,
  runnerMetadataFor,
  runnerEchoSandboxContract,
  urlInspectSandboxContract,
} from "./tool-runner";

describe("tool runner sandbox contracts", () => {
  it("builds a compact url.inspect sandbox contract from policy constraints", () => {
    const sandbox = urlInspectSandboxContract({
      allowlist: ["Example.com", "*.example.org", ""],
      denylist: ["bad.example"],
      maxRuntimeMs: 1_000,
    });

    expect(sandbox).toEqual({
      lifecycle: {
        template: "url-inspect-v1",
        setup: "per_invocation",
        workspaceState: "none",
        filesystem: "ephemeral",
        artifactPromotion: "metadata_only",
      },
      network: {
        egress: "public_web",
        allowedSchemes: ["http", "https"],
        allowedHosts: ["example.com", "*.example.org"],
        deniedHosts: ["bad.example"],
        privateNetwork: "deny",
        enforcement: "control_plane_and_runner",
      },
      limits: {
        maxRuntimeMs: 1_000,
      },
    });
    expect(JSON.stringify(sandbox)).not.toMatch(/token|secret|prompt|message/i);
  });

  it("attaches sandbox metadata to runner metadata", () => {
    const sandbox = urlInspectSandboxContract();
    const runner = runnerMetadataFor(
      {
        toolName: "url.inspect",
        adapterVersion: "url-inspect-v1",
        supportedExecutionModes: ["dry_run"],
        transport: "fly",
      },
      "admin",
      "fly",
      sandbox,
    );

    expect(runner).toMatchObject({
      transport: "fly",
      adapterVersion: "url-inspect-v1",
      source: "admin",
      sandbox: {
        network: {
          privateNetwork: "deny",
        },
      },
    });
  });

  it("builds a no-egress repo.snapshot sandbox contract", () => {
    const sandbox = repoSnapshotSandboxContract({ maxRuntimeMs: 2_500 });

    expect(sandbox).toEqual({
      lifecycle: {
        template: "repo-snapshot-v1",
        setup: "per_invocation",
        workspaceState: "none",
        filesystem: "ephemeral",
        artifactPromotion: "metadata_only",
      },
      network: {
        egress: "none",
        allowedSchemes: [],
        allowedHosts: [],
        deniedHosts: ["*"],
        privateNetwork: "deny",
        enforcement: "control_plane_and_runner",
      },
      limits: {
        maxRuntimeMs: 2_500,
        maxStdoutBytes: 65536,
        maxStderrBytes: 16384,
        maxArtifactBytes: 131072,
      },
    });
    expect(JSON.stringify(sandbox)).not.toMatch(/token|secret|prompt|message/i);
  });

  it("builds a no-egress runner.echo sandbox contract without artifact promotion", () => {
    const sandbox = runnerEchoSandboxContract({ maxRuntimeMs: 1_250 });

    expect(sandbox).toEqual({
      lifecycle: {
        template: "runner-echo-v1",
        setup: "per_invocation",
        workspaceState: "none",
        filesystem: "ephemeral",
        artifactPromotion: "metadata_only",
      },
      network: {
        egress: "none",
        allowedSchemes: [],
        allowedHosts: [],
        deniedHosts: ["*"],
        privateNetwork: "deny",
        enforcement: "control_plane_and_runner",
      },
      limits: {
        maxRuntimeMs: 1_250,
        maxStdoutBytes: 4096,
        maxStderrBytes: 4096,
        maxArtifactBytes: 0,
      },
    });
    expect(JSON.stringify(sandbox)).not.toMatch(/token|secret|prompt|command|path|url/i);
  });
});
