import { createBrowserE2eHarness, expect, test } from "../browserE2eTest.mjs";

let harness;

test.describe.configure({ mode: "serial" });

test.describe("workspace resilience and error boundary", () => {
  test.beforeAll(async () => {
    harness = await createBrowserE2eHarness({ authenticationMode: "disabled" });
  });

  test.afterAll(async () => {
    await harness?.stop();
  });

  test("renders the application error boundary when a dynamic chunk returns 404 @smoke", async ({ page }) => {
    await page.route(/\/assets\/AuthenticatedSurface-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/javascript",
        body: "// Expected Browser E2E dynamic chunk failure.",
      });
    });

    await page.goto(harness.httpOrigin);

    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: "界面暂时无法继续显示" })).toBeVisible();
    await expect(alert.getByRole("button", { name: "重新渲染" })).toBeVisible();
    await expect(alert.getByRole("button", { name: "刷新页面" })).toBeVisible();
  });

  test("recovers from a recoverable module loader failure via the retry button", async ({ page }) => {
    await page.route(/\/assets\/AuthenticatedSurface-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/javascript",
        body: "// Expected Browser E2E dynamic chunk failure.",
      });
    });

    await page.goto(harness.httpOrigin);
    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: "界面暂时无法继续显示" })).toBeVisible();

    await page.unroute(/\/assets\/AuthenticatedSurface-[^/]+\.js(?:\?.*)?$/);
    const retryChunkRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      const retryAttempt = Number(url.searchParams.get("senera-retry"));
      return (
        /\/assets\/AuthenticatedSurface-[^/]+\.js$/u.test(url.pathname) &&
        Number.isInteger(retryAttempt) &&
        retryAttempt > 0
      );
    });
    await alert.getByRole("button", { name: "重新渲染" }).click();
    await retryChunkRequest;

    await expect(workspaceComposer(page)).toBeVisible({ timeout: 15_000 });
  });

  test("keeps the workspace stable while the settings chunk is loading", async ({ page }) => {
    let releaseSettingsChunk = () => undefined;
    let markSettingsChunkRequested = () => undefined;
    const settingsChunkGate = new Promise((resolve) => {
      releaseSettingsChunk = resolve;
    });
    const settingsChunkRequested = new Promise((resolve) => {
      markSettingsChunkRequested = resolve;
    });
    await page.route(/\/assets\/SettingsOverlay-[^/]+\.js(?:\?.*)?$/, async (route) => {
      markSettingsChunkRequested();
      await settingsChunkGate;
      await route.continue();
    });

    try {
      await page.goto(harness.httpOrigin);
      await expect(workspaceComposer(page)).toBeVisible();
      await openProfileMenu(page);
      await settingsChunkRequested;
      await page.getByRole("menuitem", { name: "设置", exact: true }).click();

      await expect(workspaceComposer(page)).toBeVisible();
      await expect(page.locator("[data-settings-loading]")).toHaveCount(0);
      await expect(page.locator("[data-settings-workbench]")).toHaveCount(0);
      await expect(page).toHaveURL(`${harness.httpOrigin}/`);

      releaseSettingsChunk();
      await expect(page.locator("[data-settings-workbench]")).toBeVisible();
      await expect(page).toHaveURL(/\?settings=model-service$/);
    } finally {
      releaseSettingsChunk();
    }
  });

  test("shows the sandbox unavailable status indicator in the chat header @smoke", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    const sandboxStatus = page.locator("[data-sandbox-status]");
    await expect(sandboxStatus).toBeVisible();
    const status = await sandboxStatus.getAttribute("data-sandbox-status");
    expect(status).toBeTruthy();
  });

  test("opens the workflow dock and collapses it back via the collapse button", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await page.locator('[data-workflow-dock-tool="execution"]').click();
    const dock = page.locator('[data-workflow-dock][data-open="true"]');
    await expect(dock).toBeVisible();

    const collapseButton = dock.locator("[data-workflow-dock-collapse]");
    await expect(collapseButton).toBeVisible();
    await collapseButton.click();

    await expect(dock).toHaveCount(0);
  });

  test("keeps keyboard focus when toggling the profile menu open and closed @smoke", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    const trigger = page.locator("[data-session-sidebar]:visible").getByRole("button").filter({ hasText: "用户" });
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const editProfile = menu.getByRole("menuitem", { name: "编辑资料" });
    await expectPortaledOutsideSessionSidebar(menu);
    await expect(editProfile).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

async function expectPortaledOutsideSessionSidebar(surface) {
  await expect(surface).toBeVisible();
  expect(await surface.evaluate((element) => element.closest("[data-session-sidebar]") === null)).toBe(true);
}

async function openProfileMenu(page) {
  await page.locator("[data-session-sidebar]:visible").getByRole("button").filter({ hasText: "用户" }).click();
}

function workspaceComposer(page) {
  return page.getByLabel("输入消息");
}
