import { expect, test, type ConsoleMessage } from "@playwright/test";

const releaseMode = process.env.E2E_RELEASE_MODE;
const hydrationErrors: string[] = [];

const captureHydrationErrors = (message: ConsoleMessage) => {
  if (message.type() === "error" && message.text().includes("Hydration failed")) {
    hydrationErrors.push(message.text());
  }
};

test.beforeEach(async ({ page }) => {
  hydrationErrors.length = 0;
  page.on("console", captureHydrationErrors);
});

test("signed-out refresh stays on the deliberate access screen", async ({ page, context }) => {
  test.skip(releaseMode !== "signed-out");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to resume your work" })).toBeVisible();
  await expect(page.getByText("Recent chats", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Workspace access" })).toHaveCount(0);

  await expect
    .poll(async () => {
      const cookies = await context.cookies();
      return cookies.find((cookie) => cookie.name === "assistant-mk1-auth-presentation")?.value;
    })
    .toBe("signed-out");

  const response = await page.reload();
  expect(response).not.toBeNull();
  const firstFrameHtml = await response!.text();
  expect(firstFrameHtml).toContain("Sign in to resume your work");
  expect(firstFrameHtml).not.toContain("How can I help you today?");
  await expect(page.getByRole("heading", { name: "Sign in to resume your work" })).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("trusted local session is immediately usable and exposes release controls", async ({
  page,
}) => {
  test.skip(releaseMode !== "local-session");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hello there!" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message input" })).toBeEditable();

  await page.route("**/api/workbench/chat-session/stage-thread**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  const newChatStartedAt = Date.now();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByRole("textbox", { name: "Draft message" })).toBeEditable();
  expect(Date.now() - newChatStartedAt).toBeLessThan(1_200);
  await expect(page.getByRole("button", { name: /Run a readiness check/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Plan a project handoff/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Test agent behavior/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Explain a failure/i })).toBeVisible();

  await page.getByRole("button", { name: "Workspace access" }).click();
  await expect(page.getByRole("dialog", { name: "Workspace" })).toBeVisible();
  await expect(page.getByText("Default Workspace", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Role for e2e-owner" })).toHaveValue("owner");
  await page.getByRole("button", { name: "Close" }).click();

  const composer = page.getByRole("textbox", { name: /Message input|Draft message/ });
  await composer.fill("/admin");
  await composer.press("Enter");
  await expect(page.getByRole("dialog", { name: "Admin" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Agents & Packs" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tools & Approvals" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Diagnostics" })).toBeVisible();

  await page.getByRole("tab", { name: "Agents & Packs" }).click();
  const repositoryPack = page.locator("article").filter({ hasText: "Repository Analyst" });
  await expect(repositoryPack).toContainText("Version 1.1.0");
  await expect(page.getByText("Polymancer Research", { exact: true })).toBeVisible();
  await expect(page.getByText("Swordfish Runtime", { exact: true })).toBeVisible();
  await repositoryPack.getByRole("button", { name: "Use pack" }).click();

  await expect(page.getByRole("dialog", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Repository Analyst" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Assess release readiness/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Map the architecture/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Find the next slice/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review release risk/i })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /Assess release readiness/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Map the architecture/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Find the next slice/i })).toBeHidden();
  await expect(page.getByRole("button", { name: /Review release risk/i })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Repository Analyst tools" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available to you" })).toBeVisible();
  await expect(page.getByText("Readiness report", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent only" })).toBeVisible();
  await expect(page.getByText("No conversational agent-only tools are enabled.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inside workflows" })).toBeVisible();
  await expect(page.getByText("repo.snapshot", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Assess release readiness/i }).click();
  await expect(page.getByRole("dialog", { name: "Readiness report" })).toBeVisible();
  await expect(page.getByText("Documentation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run dry-run" }).click();
  await expect(page.getByRole("dialog", { name: "Workbench History" })).toBeVisible();
  await expect(page.getByText("Repository snapshot report", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("listitem").filter({ hasText: "Release recovery fixture" }),
  ).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Release recovery fixture" })
    .getByRole("button", { name: "Inspect" })
    .click();
  await expect(page.getByRole("button", { name: "Retry run" })).toBeVisible();

  expect(hydrationErrors).toEqual([]);
});
