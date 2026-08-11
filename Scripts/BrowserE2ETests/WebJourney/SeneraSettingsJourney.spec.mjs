import { createBrowserE2eHarness, expect, test } from "../browserE2eTest.mjs";

let harness;

test.describe.configure({ mode: "serial" });

test.describe("settings navigation and section management", () => {
  test.beforeAll(async () => {
    harness = await createBrowserE2eHarness({ authenticationMode: "disabled" });
  });

  test.afterAll(async () => {
    await harness?.stop();
  });

  test("loads the appearance section through a /settings/appearance deep link @smoke", async ({ page }) => {
    await page.goto(`${harness.httpOrigin}/settings/appearance`);

    await expect(page.locator("[data-settings-workbench]")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { level: 2, name: "外观" })).toBeVisible();
    await expect(page).toHaveURL(`${harness.httpOrigin}/settings/appearance`);
  });

  test("navigates between settings sections via the section nav and updates the URL", async ({ page }) => {
    await page.goto(`${harness.httpOrigin}/settings/model-service`);
    await expect(page.locator("[data-settings-workbench]")).toBeVisible();

    const sectionsNav = page.getByLabel("设置分区");
    await expect(sectionsNav).toBeVisible();

    const generalButton = sectionsNav.getByRole("button", { name: /通用/ });
    await expect(generalButton).toBeVisible();
    await generalButton.click();
    await expect(page).toHaveURL(/\/settings\/general$/);

    const appearanceButton = sectionsNav.getByRole("button", { name: /外观/ });
    await appearanceButton.click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page.getByRole("heading", { level: 2, name: "外观" })).toBeVisible();
  });

  test("opens settings from the workspace profile menu and returns on close", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await openProfileMenu(page);
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();

    await expect(page.locator("[data-settings-workbench]")).toBeVisible();
    await expect(page).toHaveURL(/\?settings=model-service$/);

    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.locator("[data-settings-workbench]")).toHaveCount(0);
    await expect(page).toHaveURL(`${harness.httpOrigin}/`);
  });

  test("filters settings sections through the search input", async ({ page }) => {
    await page.goto(`${harness.httpOrigin}/settings/model-service`);
    await expect(page.locator("[data-settings-workbench]")).toBeVisible();

    const searchBox = page.getByLabel("搜索设置");
    await expect(searchBox).toBeVisible();
    await searchBox.fill("外观");

    const sectionsNav = page.getByLabel("设置分区");
    const visibleButtons = sectionsNav.getByRole("button");
    const visibleCount = await visibleButtons.count();
    expect(visibleCount).toBeGreaterThan(0);

    const appearanceButton = sectionsNav.getByRole("button", { name: /外观/ });
    await expect(appearanceButton).toBeVisible();

    const clearSearch = page.getByLabel("清除搜索");
    await clearSearch.click();
    await expect(searchBox).toHaveValue("");
  });

  test("keeps the settings overlay stable when navigating to a non-existent section", async ({ page }) => {
    await page.goto(`${harness.httpOrigin}/settings/nonexistent`);

    await expect(page.locator("[data-settings-workbench]")).toBeVisible();
    const heading = page.getByRole("dialog").getByRole("heading", { level: 2 });
    await expect(heading).toBeVisible();
  });

  test("reflects the save status indicator after editing a provider API URL", async ({ page }) => {
    await page.goto(`${harness.httpOrigin}/settings/model-service`);
    await expect(page.locator("[data-settings-workbench]")).toBeVisible();

    const apiUrl = page.getByLabel("API 地址");
    await expect(apiUrl).toBeVisible();
    const originalValue = await apiUrl.inputValue();

    await apiUrl.fill("https://e2e-settings-journey.example.com/api");
    await expect(apiUrl).toHaveValue("https://e2e-settings-journey.example.com/api");

    const saveButton = page.getByRole("button", { name: "保存" });
    if (await saveButton.isVisible()) {
      await saveButton.click();
      await expect(page.locator("[data-settings-save-status]")).toBeVisible();
    }

    if (originalValue) {
      await apiUrl.fill(originalValue);
      const restoreSave = page.getByRole("button", { name: "保存" });
      if (await restoreSave.isVisible()) {
        await restoreSave.click();
      }
    }
  });
});

async function openProfileMenu(page) {
  await page.locator("[data-session-sidebar]:visible").getByRole("button").filter({ hasText: "用户" }).click();
}

function workspaceComposer(page) {
  return page.getByLabel("输入消息");
}
