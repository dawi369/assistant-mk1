import { expect, test, type Page } from "@playwright/test";

const releaseMode = process.env.E2E_RELEASE_MODE;
const workerOrigin = "http://127.0.0.1:8788";

type HistoryRun = {
  id: string;
  status: string;
  displayName?: string;
  data?: Record<string, unknown>;
};

const historyRuns = async (page: Page) => {
  const response = await page.request.get("/api/workbench/history/runs");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { runs?: HistoryRun[] }).runs ?? [];
};

const activateRepositoryAnalyst = async (page: Page) => {
  const composer = page.getByRole("textbox", { name: /Message input|Draft message/ });
  await composer.fill("/admin");
  await composer.press("Enter");
  await page.getByRole("tab", { name: "Agents & Packs" }).click();
  const repositoryPack = page.locator("article").filter({ hasText: "Repository Analyst" });
  await repositoryPack.getByRole("button", { name: "Use pack" }).click();
  await expect(page.getByRole("heading", { name: "Repository Analyst" })).toBeVisible();
};

test.describe.serial("Level 2 executable conformance", () => {
  test.skip(releaseMode !== "local-session");
  test.setTimeout(90_000);

  test("approval recovery, cancellation, retry, handoff, and tenant isolation", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hello there!" })).toBeVisible();

    await page.getByRole("button", { name: "Workspace access" }).click();
    const workspaceDialog = page.getByRole("dialog", { name: "Workspace" });
    await expect(workspaceDialog.getByText("Default Workspace", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Role for e2e-owner" })).toHaveValue("owner");
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "History" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Approval recovery fixture" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();
    await page.getByRole("button", { name: "Deny" }).click();
    await expect(page.getByText("cancelled", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
    await page.getByRole("button", { name: "Close" }).click();

    await activateRepositoryAnalyst(page);
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/workbench/agents");
        const body = (await response.json()) as {
          activeAgentId?: string;
          agents?: Array<{ id: string; name?: string }>;
        };
        return body.agents?.find((agent) => agent.id === body.activeAgentId)?.name;
      })
      .toBe("Repository Analyst");

    await page.evaluate(() => {
      (window as typeof window & { level2Run?: Promise<unknown> }).level2Run = fetch(
        "/api/workbench/workflows/repo/readiness-report",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            executionMode: "dry_run",
            input: { includeDocs: true, includeScripts: true, includeConfig: true },
          }),
        },
      ).then(async (response) => ({ status: response.status, body: await response.json() }));
    });

    let activeRun: HistoryRun | undefined;
    await expect
      .poll(async () => {
        activeRun = (await historyRuns(page)).find(
          (run) => run.displayName === "Repository readiness report" && run.status === "running",
        );
        return activeRun?.id;
      })
      .toBeTruthy();

    const cancelledRunId = activeRun!.id;
    const cancelResponse = await page.request.post(
      `/api/workbench/history/runs/${encodeURIComponent(cancelledRunId)}/cancel`,
    );
    expect(cancelResponse.ok()).toBe(true);
    await page.waitForTimeout(2_000);

    const cancelledSnapshotResponse = await page.request.get(
      `/api/workbench/history/runs/${encodeURIComponent(cancelledRunId)}`,
    );
    expect(cancelledSnapshotResponse.ok()).toBe(true);
    const cancelledSnapshot = (await cancelledSnapshotResponse.json()) as {
      snapshot?: { run?: { status?: string }; artifacts?: unknown[] };
    };
    expect(cancelledSnapshot.snapshot?.run?.status).toBe("cancelled");
    expect(cancelledSnapshot.snapshot?.artifacts ?? []).toEqual([]);

    const retryResponse = await page.request.post(
      `/api/workbench/history/runs/${encodeURIComponent(cancelledRunId)}/retry`,
    );
    expect(retryResponse.ok()).toBe(true);
    const retried = (await retryResponse.json()) as { run?: { id?: string; runId?: string } };
    const retriedRunId = retried.run?.id ?? retried.run?.runId;
    expect(retriedRunId).toBeTruthy();
    expect(retriedRunId).not.toBe(cancelledRunId);

    const retriedSnapshotResponse = await page.request.get(
      `/api/workbench/history/runs/${encodeURIComponent(retriedRunId!)}`,
    );
    const retriedSnapshot = (await retriedSnapshotResponse.json()) as {
      snapshot?: {
        run?: { status?: string; data?: Record<string, unknown> };
        artifacts?: unknown[];
      };
    };
    expect(retriedSnapshot.snapshot?.run?.status).toBe("completed");
    expect(retriedSnapshot.snapshot?.run?.data?.retryOfRunId).toBe(cancelledRunId);
    expect(retriedSnapshot.snapshot?.artifacts?.length).toBeGreaterThan(0);

    const sessionResponse = await page.request.post("/api/workbench/chat-session/threads", {
      data: { title: "Level 2 handoff fixture" },
    });
    expect(sessionResponse.ok()).toBe(true);
    const session = (await sessionResponse.json()) as {
      activeThread?: { threadId?: string; agentId?: string };
      connection?: { token?: string; instanceName?: string; agentId?: string; threadId?: string };
    };
    const agentsResponse = await page.request.get("/api/workbench/agents");
    const agents = (await agentsResponse.json()) as { agents?: Array<{ id: string }> };
    const targetAgent = agents.agents?.find((agent) => agent.id !== session.connection?.agentId);
    expect(session.connection?.threadId).toBeTruthy();
    expect(session.connection?.token).toBeTruthy();
    expect(targetAgent?.id).toBeTruthy();

    const switchResponse = await page.request.post("/api/workbench/chat-session/agent-switch", {
      data: {
        agentId: targetAgent!.id,
        target: "current_thread",
        threadId: session.connection!.threadId,
      },
    });
    expect(switchResponse.ok()).toBe(true);
    const switched = (await switchResponse.json()) as {
      activeThread?: { agentId?: string };
      transition?: { type?: string };
    };
    expect(switched.transition?.type).toBe("agent_handoff");
    expect(switched.activeThread?.agentId).toBe(targetAgent!.id);

    const staleTokenResponse = await request.get(
      `${workerOrigin}/agents/workbench-thread-chat-agent/${encodeURIComponent(session.connection!.instanceName ?? "")}?token=${encodeURIComponent(session.connection!.token ?? "")}`,
    );
    expect(staleTokenResponse.status()).toBe(403);

    const otherHeaders = {
      authorization: "Bearer e2e-control-plane-token",
      "x-assistant-mk1-user-id": "tenant-b-user",
      "x-assistant-mk1-workspace-id": "tenant-b-workspace",
      "x-assistant-mk1-agent-id": "tenant-b-agent",
      "x-assistant-mk1-account-id": "local-dev:tenant-b-workspace",
      "x-assistant-mk1-account-source": "local-dev",
    };
    const bootstrapOther = await request.get(`${workerOrigin}/workspace-context`, {
      headers: otherHeaders,
    });
    expect(bootstrapOther.ok()).toBe(true);
    for (const operation of [
      request.get(`${workerOrigin}/workbench/history/runs/${retriedRunId}`, {
        headers: otherHeaders,
      }),
      request.post(`${workerOrigin}/workbench/history/runs/${retriedRunId}/cancel`, {
        headers: otherHeaders,
      }),
      request.post(`${workerOrigin}/workbench/history/runs/${retriedRunId}/retry`, {
        headers: otherHeaders,
      }),
    ]) {
      expect((await operation).status()).toBe(404);
    }
    const otherArtifacts = await request.get(`${workerOrigin}/workbench/history/artifacts`, {
      headers: otherHeaders,
    });
    expect(otherArtifacts.ok()).toBe(true);
    expect(JSON.stringify(await otherArtifacts.json())).not.toContain(retriedRunId);
  });
});
