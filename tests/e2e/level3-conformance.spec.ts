import { expect, test, type Page } from "@playwright/test";

import { activateRepositoryAnalyst } from "./workbench-helpers";

const releaseMode = process.env.E2E_RELEASE_MODE;
const workerOrigin = "http://127.0.0.1:8788";

type Trigger = {
  id: string;
  packTriggerId: string;
  status: string;
  version: number;
  publicId?: string;
  nextTriggerAt?: string;
};

type Dispatch = {
  id: string;
  triggerId: string;
  source: string;
  status: string;
  attemptCount: number;
  runId?: string;
  previousRunId?: string;
};

const listDispatches = async (page: Page, triggerId?: string) => {
  const query = triggerId ? `?triggerId=${encodeURIComponent(triggerId)}&limit=100` : "?limit=100";
  const response = await page.request.get(`/api/workbench/trigger-dispatches${query}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { dispatches?: Dispatch[] }).dispatches ?? [];
};

test.describe.serial("Level 3 executable conformance", () => {
  test.skip(releaseMode !== "local-session");
  test.setTimeout(150_000);

  test("scheduled and webhook monitors are idempotent, cancellable, replayable, and tenant isolated", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hello there!" })).toBeVisible();
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

    const scheduleCreate = await page.request.post("/api/workbench/triggers", {
      data: {
        packId: "repo-analyst",
        packTriggerId: "scheduled-readiness",
        status: "enabled",
      },
    });
    expect(scheduleCreate.status()).toBe(201);
    const schedule = ((await scheduleCreate.json()) as { trigger?: Trigger }).trigger!;
    expect(schedule.packTriggerId).toBe("scheduled-readiness");
    expect(schedule.nextTriggerAt).toBeTruthy();

    const manualReceipt = await page.request.post(
      `/api/workbench/triggers/${encodeURIComponent(schedule.id)}/dispatches`,
      { data: { idempotencyKey: "level3-cancel-replay", payload: {} } },
    );
    expect(manualReceipt.status()).toBe(201);
    const manualDispatch = ((await manualReceipt.json()) as { dispatch?: Dispatch }).dispatch!;

    let runningDispatch: Dispatch | undefined;
    await expect
      .poll(async () => {
        runningDispatch = (await listDispatches(page, schedule.id)).find(
          (dispatch) => dispatch.id === manualDispatch.id,
        );
        return runningDispatch?.status;
      })
      .toBe("running");
    expect(runningDispatch?.runId).toBeTruthy();

    const cancelledRunId = runningDispatch!.runId!;
    const cancel = await page.request.post(
      `/api/workbench/history/runs/${encodeURIComponent(cancelledRunId)}/cancel`,
    );
    expect(cancel.ok()).toBe(true);
    await expect
      .poll(
        async () =>
          (await listDispatches(page, schedule.id)).find(
            (dispatch) => dispatch.id === manualDispatch.id,
          )?.status,
      )
      .toBe("cancelled");

    const replay = await page.request.post(
      `/api/workbench/trigger-dispatches/${encodeURIComponent(manualDispatch.id)}/replay`,
    );
    expect(replay.ok()).toBe(true);
    await expect
      .poll(
        async () => {
          const dispatch = (await listDispatches(page, schedule.id)).find(
            (candidate) => candidate.id === manualDispatch.id,
          );
          return dispatch?.status === "completed" ? dispatch : undefined;
        },
        { timeout: 30_000 },
      )
      .toMatchObject({
        attemptCount: 2,
        previousRunId: cancelledRunId,
      });
    const replayedDispatch = (await listDispatches(page, schedule.id)).find(
      (candidate) => candidate.id === manualDispatch.id,
    )!;
    expect(replayedDispatch.runId).not.toBe(cancelledRunId);
    const replayedRun = await page.request.get(
      `/api/workbench/history/runs/${encodeURIComponent(replayedDispatch.runId!)}`,
    );
    const replayedSnapshot = (await replayedRun.json()) as {
      snapshot?: { run?: { data?: Record<string, unknown> }; artifacts?: unknown[] };
    };
    expect(replayedSnapshot.snapshot?.run?.data?.retryOfRunId).toBe(cancelledRunId);
    expect(replayedSnapshot.snapshot?.artifacts?.length).toBeGreaterThan(0);

    const managedStateResponse = await page.request.get(
      "/api/workbench/managed-state?namespace=repo-monitor&type=repository-readiness",
    );
    expect(managedStateResponse.ok()).toBe(true);
    const managedState = (await managedStateResponse.json()) as {
      states?: Array<{ status?: string; data?: Record<string, unknown> }>;
    };
    expect(managedState.states?.[0]?.status).toBe("ready");
    expect(managedState.states?.[0]?.data?.runId).toBe(replayedDispatch.runId);

    const scheduledAt = Date.parse(schedule.nextTriggerAt!) + 1_000;
    const scheduledTick = await request.get(
      `${workerOrigin}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&time=${scheduledAt}&format=json`,
    );
    expect(scheduledTick.ok()).toBe(true);
    await expect
      .poll(
        async () =>
          (await listDispatches(page, schedule.id)).find(
            (dispatch) => dispatch.source === "schedule" && dispatch.status === "completed",
          )?.id,
        { timeout: 30_000 },
      )
      .toBeTruthy();

    const webhookCreate = await page.request.post("/api/workbench/triggers", {
      data: {
        packId: "repo-analyst",
        packTriggerId: "readiness-requested",
        status: "enabled",
      },
    });
    expect(webhookCreate.status()).toBe(201);
    const webhookBody = (await webhookCreate.json()) as {
      trigger?: Trigger;
      webhookSecret?: string;
    };
    expect(webhookBody.trigger?.publicId).toBeTruthy();
    expect(webhookBody.webhookSecret).toBeTruthy();
    const webhookPath = `/api/external-signals/${encodeURIComponent(webhookBody.trigger!.publicId!)}`;
    const webhookHeaders = {
      authorization: `Bearer ${webhookBody.webhookSecret}`,
      "idempotency-key": "level3-webhook-delivery",
    };
    const webhook = await page.request.post(webhookPath, {
      headers: webhookHeaders,
      data: { includeDocs: true, includeScripts: true, includeConfig: true },
    });
    expect(webhook.status()).toBe(202);
    const webhookReceipt = (await webhook.json()) as { dispatchId?: string };
    const duplicateWebhook = await page.request.post(webhookPath, {
      headers: webhookHeaders,
      data: { includeDocs: true, includeScripts: true, includeConfig: true },
    });
    expect(duplicateWebhook.status()).toBe(200);
    expect(await duplicateWebhook.json()).toMatchObject({
      duplicate: true,
      dispatchId: webhookReceipt.dispatchId,
    });
    await expect
      .poll(
        async () =>
          (await listDispatches(page, webhookBody.trigger!.id)).find(
            (dispatch) => dispatch.id === webhookReceipt.dispatchId,
          )?.status,
        { timeout: 30_000 },
      )
      .toBe("completed");

    const composer = page.getByRole("textbox", { name: /Message input|Draft message/ });
    await composer.fill("/admin");
    await composer.press("Enter");
    await page.getByRole("tab", { name: "Agents & Packs" }).click();
    await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
    await expect(page.getByText("scheduled-readiness", { exact: true })).toBeVisible();
    await expect(page.getByText("readiness-requested", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent dispatches", { exact: true })).toBeVisible();

    const otherHeaders = {
      authorization: "Bearer e2e-control-plane-token",
      "x-assistant-mk1-user-id": "level3-tenant-b-user",
      "x-assistant-mk1-workspace-id": "level3-tenant-b-workspace",
      "x-assistant-mk1-agent-id": "level3-tenant-b-agent",
      "x-assistant-mk1-account-id": "local-dev:level3-tenant-b-workspace",
      "x-assistant-mk1-account-source": "local-dev",
    };
    expect(
      (
        await request.get(`${workerOrigin}/triggers/${encodeURIComponent(schedule.id)}`, {
          headers: otherHeaders,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(
          `${workerOrigin}/trigger-dispatches/${encodeURIComponent(manualDispatch.id)}`,
          { headers: otherHeaders },
        )
      ).status(),
    ).toBe(404);
  });
});
