import { expect, test, type APIRequestContext } from "@playwright/test";

const releaseMode = process.env.E2E_RELEASE_MODE;
const workerOrigin = "http://127.0.0.1:8788";

const pollDataJob = async (
  request: APIRequestContext,
  headers: Record<string, string>,
  jobId: string,
) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request.get(
      `${workerOrigin}/workbench/data-exports/${encodeURIComponent(jobId)}`,
      { headers },
    );
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as {
      job: { status: string; contentSha256?: string; sizeBytes?: number };
    };
    if (body.job.status === "completed") return body.job;
    if (body.job.status === "failed") throw new Error("Data export failed.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Data export did not complete within the bounded polling window.");
};

test.describe.serial("Production customer-data lifecycle", () => {
  test.skip(releaseMode !== "local-session");
  test.setTimeout(60_000);

  test("exports complete tenant state and enforces quarantine recovery", async ({ request }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workspaceName = `Lifecycle ${suffix}`;
    const headers = {
      authorization: "Bearer e2e-control-plane-token",
      "x-assistant-mk1-user-id": `lifecycle-owner-${suffix}`,
      "x-assistant-mk1-workspace-id": `lifecycle-workspace-${suffix}`,
      "x-assistant-mk1-agent-id": `lifecycle-agent-${suffix}`,
      "x-assistant-mk1-account-id": `local-dev:lifecycle-workspace-${suffix}`,
      "x-assistant-mk1-account-source": "local-dev",
      "x-assistant-mk1-workspace-name": workspaceName,
    };

    const bootstrap = await request.get(`${workerOrigin}/admin/workspace-summary`, { headers });
    expect(bootstrap.status(), await bootstrap.text()).toBe(200);

    const memberUserId = `lifecycle-member-${suffix}`;
    const memberHeaders = {
      ...headers,
      "x-assistant-mk1-user-id": memberUserId,
      "x-assistant-mk1-agent-id": `lifecycle-member-agent-${suffix}`,
    };
    const memberBootstrap = await request.get(`${workerOrigin}/admin/workspace-summary`, {
      headers: memberHeaders,
    });
    expect(memberBootstrap.status(), await memberBootstrap.text()).toBe(200);

    const instantiated = await request.post(
      `${workerOrigin}/agent-packs/complex-operator/instantiate`,
      { headers },
    );
    expect(instantiated.status(), await instantiated.text()).toBe(201);
    const instantiatedBody = (await instantiated.json()) as { agent: { id: string } };
    const activate = await request.post(
      `${workerOrigin}/agents/${encodeURIComponent(instantiatedBody.agent.id)}/activate`,
      { headers },
    );
    expect(activate.status(), await activate.text()).toBe(200);
    const activeHeaders = {
      ...headers,
      "x-assistant-mk1-agent-id": instantiatedBody.agent.id,
    };

    const retention = await request.patch(`${workerOrigin}/workbench/retention-policy`, {
      headers,
      data: {
        chatMessageRetentionDays: 45,
        runPayloadRetentionDays: 60,
        artifactRetentionDays: 75,
        operationalEventRetentionDays: 20,
        runtimeTraceRetentionDays: 10,
        auditActionRetentionDays: 365,
        confirm: true,
      },
    });
    expect(retention.status(), await retention.text()).toBe(200);
    expect(await retention.json()).toMatchObject({
      policy: {
        confirmed: true,
        chatMessageRetentionDays: 45,
        runPayloadRetentionDays: 60,
        artifactRetentionDays: 75,
      },
    });

    const secret = `lifecycle-secret-${suffix}`;
    const connection = await request.post(
      `${workerOrigin}/workbench/connections/operator.external-account/credentials`,
      { headers: activeHeaders, data: { secret } },
    );
    expect(connection.status(), await connection.text()).toBe(201);

    const created = await request.post(`${workerOrigin}/workbench/data-exports`, {
      headers: activeHeaders,
    });
    expect(created.status(), await created.text()).toBe(202);
    const createdBody = (await created.json()) as { job: { id: string } };
    const completed = await pollDataJob(request, activeHeaders, createdBody.job.id);
    expect(completed.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(completed.sizeBytes).toBeGreaterThan(0);

    const download = await request.get(
      `${workerOrigin}/workbench/data-exports/${encodeURIComponent(createdBody.job.id)}/download`,
      { headers: activeHeaders },
    );
    expect(download.status(), await download.text()).toBe(200);
    expect(download.headers()["content-type"]).toContain("application/zip");
    expect(download.headers()["cache-control"]).toBe("private, no-store");
    const archive = await download.body();
    expect(archive.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(archive.includes(Buffer.from(memberUserId))).toBe(true);
    expect(archive.includes(Buffer.from(secret))).toBe(false);

    const otherHeaders = {
      ...headers,
      "x-assistant-mk1-user-id": `lifecycle-other-owner-${suffix}`,
      "x-assistant-mk1-workspace-id": `lifecycle-other-workspace-${suffix}`,
      "x-assistant-mk1-agent-id": `lifecycle-other-agent-${suffix}`,
      "x-assistant-mk1-account-id": `local-dev:lifecycle-other-workspace-${suffix}`,
      "x-assistant-mk1-workspace-name": `Other ${suffix}`,
    };
    const crossTenant = await request.get(
      `${workerOrigin}/workbench/data-exports/${encodeURIComponent(createdBody.job.id)}`,
      { headers: otherHeaders },
    );
    expect(crossTenant.status()).toBe(404);

    const deletion = await request.post(`${workerOrigin}/workbench/workspace-deletion`, {
      headers: activeHeaders,
      data: { workspaceName, reauthenticatedAt: new Date().toISOString() },
    });
    expect(deletion.status(), await deletion.text()).toBe(202);
    expect(await deletion.json()).toMatchObject({
      deletion: {
        status: "quarantined",
        credentialsRecoverable: false,
        credentialRevocation: "completed",
      },
    });

    const blocked = await request.get(`${workerOrigin}/workbench/actions`, {
      headers: activeHeaders,
    });
    expect(blocked.status()).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "Workspace is not active" });
    const blockedMember = await request.get(`${workerOrigin}/workbench/actions`, {
      headers: memberHeaders,
    });
    expect(blockedMember.status()).toBe(403);

    const status = await request.get(`${workerOrigin}/workbench/workspace-deletion`, {
      headers: activeHeaders,
    });
    expect(status.status(), await status.text()).toBe(200);
    expect(await status.json()).toMatchObject({ deletion: { status: "quarantined" } });

    const recovered = await request.delete(`${workerOrigin}/workbench/workspace-deletion`, {
      headers: activeHeaders,
    });
    expect(recovered.status(), await recovered.text()).toBe(200);
    expect(await recovered.json()).toMatchObject({
      deletion: {
        status: "recovered",
        credentialsRestored: false,
        triggersRestored: false,
      },
    });

    const restored = await request.get(`${workerOrigin}/workbench/actions`, {
      headers: activeHeaders,
    });
    expect(restored.status(), await restored.text()).toBe(200);
    const connections = await request.get(`${workerOrigin}/workbench/connections`, {
      headers: activeHeaders,
    });
    expect(connections.status(), await connections.text()).toBe(200);
    expect(await connections.json()).toMatchObject({
      connections: expect.arrayContaining([
        expect.objectContaining({ id: "operator.external-account", status: "revoked" }),
      ]),
    });
  });
});
