import { expect, test } from "@playwright/test";

const releaseMode = process.env.E2E_RELEASE_MODE;
const workerOrigin = "http://127.0.0.1:8788";
const headers = {
  authorization: "Bearer e2e-control-plane-token",
  "x-assistant-mk1-user-id": "e2e-owner",
  "x-assistant-mk1-workspace-id": "e2e-workspace",
  "x-assistant-mk1-agent-id": "e2e-complex-agent",
  "x-assistant-mk1-account-id": "local-dev:e2e-workspace",
  "x-assistant-mk1-account-source": "local-dev",
};
const activeAgentHeaders = {
  ...headers,
  "x-assistant-mk1-agent-id": "e2e-agent",
};

test.describe.serial("Agent-system executable conformance", () => {
  test.skip(releaseMode !== "local-session");
  test.setTimeout(60_000);

  test("an external-style package executes through Cloudflare, signed Fly, and D1", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hello there!" })).toBeVisible();

    const activate = await request.post(`${workerOrigin}/agents/e2e-complex-agent/activate`, {
      headers: activeAgentHeaders,
    });
    expect(activate.status(), await activate.text()).toBe(200);

    const response = await request.post(
      `${workerOrigin}/workbench/workflows/complex-operator.observe`,
      {
        headers,
        data: {
          executionMode: "dry_run",
          input: { subject: "service-boundary" },
        },
      },
    );
    expect(response.status(), await response.text()).toBe(201);
    const receipt = (await response.json()) as {
      run?: { id?: string; runtimeVersion?: string; engine?: string };
      artifact?: { id?: string; kind?: string };
      report?: {
        signal?: { signal?: string };
        snapshot?: { subject?: string; status?: string };
        proposal?: { status?: string };
      };
    };
    expect(receipt.run).toMatchObject({ runtimeVersion: "1.0.0", engine: "cloudflare" });
    expect(receipt.artifact).toMatchObject({ kind: "complex_operator_report" });
    expect(receipt.report).toMatchObject({
      signal: { signal: "nominal" },
      snapshot: { subject: "service-boundary", status: "nominal" },
      proposal: { status: "proposed" },
    });

    const snapshotResponse = await request.get(
      `${workerOrigin}/workbench/history/runs/${encodeURIComponent(receipt.run!.id!)}`,
      { headers },
    );
    expect(snapshotResponse.ok()).toBe(true);
    const snapshot = (await snapshotResponse.json()) as {
      snapshot?: {
        run?: { status?: string; engine?: string; data?: Record<string, unknown> };
        toolCalls?: Array<{ toolId?: string; status?: string; data?: Record<string, unknown> }>;
        artifacts?: Array<{ id?: string; kind?: string }>;
      };
    };
    expect(snapshot.snapshot?.run).toMatchObject({
      status: "completed",
      engine: "cloudflare",
      data: {
        packId: "complex-operator",
        packVersion: "1.0.0",
        runtimeVersion: "1.0.0",
        workflowType: "complex-operator.observe",
      },
    });
    expect(snapshot.snapshot?.toolCalls?.map((call) => call.toolId)).toEqual([
      "operator.signal.read",
      "operator.snapshot",
      "operator.action.propose",
    ]);
    expect(
      snapshot.snapshot?.toolCalls?.find((call) => call.toolId === "operator.snapshot")?.data,
    ).toMatchObject({
      transport: "fly",
      adapterVersion: "operator-snapshot-v1",
    });
    expect(snapshot.snapshot?.artifacts).toContainEqual(
      expect.objectContaining({ id: receipt.artifact?.id, kind: "complex_operator_report" }),
    );

    const managedStateResponse = await request.get(
      `${workerOrigin}/workbench/managed-state?namespace=complex-operator&type=observation`,
      { headers },
    );
    expect(managedStateResponse.ok()).toBe(true);
    expect(await managedStateResponse.json()).toMatchObject({
      states: [
        expect.objectContaining({
          status: "review",
          namespace: "complex-operator",
          stateType: "observation",
        }),
      ],
    });
  });
});
