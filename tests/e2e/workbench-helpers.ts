import { expect, type Page } from "@playwright/test";

export const activateRepositoryAnalyst = async (page: Page) => {
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/workbench/admin-access");
      return response.ok() && ((await response.json()) as { isAdmin?: boolean }).isAdmin;
    })
    .toBe(true);

  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog", { name: "Admin" })).toBeVisible();
  await page.getByRole("tab", { name: "Agents & Packs" }).click();

  const repositoryPack = page.locator("article").filter({ hasText: "Repository Analyst" });
  await repositoryPack.getByRole("button", { name: "Use pack" }).click();
  await expect(page.getByRole("heading", { name: "Repository Analyst" })).toBeVisible();
};
