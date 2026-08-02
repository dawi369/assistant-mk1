import { expect, type Page } from "@playwright/test";

export const openAdminAgentsPanel = async (page: Page) => {
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/workbench/admin-access");
      return response.ok() && ((await response.json()) as { isAdmin?: boolean }).isAdmin;
    })
    .toBe(true);

  const composer = page.getByRole("textbox", { name: /Message input|Draft message/ });
  await composer.fill("/admin");
  await page.getByText("Open workspace, agent, and runtime controls.", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Admin" })).toBeVisible();
  await page.getByRole("tab", { name: "Agents & Packs" }).click();
};

export const activateRepositoryAnalyst = async (page: Page) => {
  await openAdminAgentsPanel(page);

  const repositoryPack = page.locator("article").filter({ hasText: "Repository Analyst" });
  await repositoryPack.getByRole("button", { name: "Use pack" }).click();
  await expect(page.getByRole("heading", { name: "Repository Analyst" })).toBeVisible();
};
