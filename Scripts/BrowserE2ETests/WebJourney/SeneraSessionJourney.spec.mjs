import { RealRuntimeIntegrationValues } from "../../../Dist/Scripts/IntegrationTests/RuntimeIntegration/RealRuntimeIntegrationHarness.js";
import { createBrowserE2eHarness, expect, test } from "../browserE2eTest.mjs";

let harness;

test.describe.configure({ mode: "serial" });

test.describe("session lifecycle and sidebar management", () => {
  test.beforeAll(async () => {
    harness = await createBrowserE2eHarness({ authenticationMode: "disabled" });
  });

  test.afterAll(async () => {
    await harness?.stop();
  });

  test("creates multiple sessions and reuses an empty session", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    const rows = page.locator("[data-session-row]");
    await renameActiveSession(page, "E2E Session Creation Seed");
    const initialCount = await rows.count();

    await newSessionButton(page).click();
    await expect(rows).toHaveCount(initialCount + 1);
    const firstRow = rows.first();
    await expect(firstRow.locator("[data-active-session-indicator]")).toBeVisible();

    await newSessionButton(page).click();
    await expect(rows).toHaveCount(initialCount + 1);
    await expect(rows.first().locator("[data-active-session-indicator]")).toBeVisible();
  });

  test("switches between sessions and preserves the active selection", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await renameActiveSession(page, "E2E Session Switching Seed");
    await newSessionButton(page).click();
    const rows = page.locator("[data-session-row]");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const firstSelection = rows.nth(0).getByRole("button", { name: /^打开会话：/ });
    const secondSelection = rows.nth(1).getByRole("button", { name: /^打开会话：/ });

    await secondSelection.click();
    await expect(rows.nth(1).locator("[data-active-session-indicator]")).toBeVisible();
    await expect(rows.nth(0).locator("[data-active-session-indicator]")).toHaveCount(0);

    await firstSelection.click();
    await expect(rows.nth(0).locator("[data-active-session-indicator]")).toBeVisible();
    await expect(rows.nth(1).locator("[data-active-session-indicator]")).toHaveCount(0);
  });

  test("renames a session via keyboard context menu and keeps focus on the renamed row", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await newSessionButton(page).click();
    const sessionRow = page.locator("[data-session-row]").first();
    const selection = sessionRow.getByRole("button", { name: /^打开会话：/ });
    await expect(selection).toBeVisible();

    await selection.focus();
    await selection.press("Shift+F10");

    const menu = page.getByRole("menu");
    const rename = menu.getByRole("menuitem", { name: "重命名" });
    await expectPortaledOutsideSessionSidebar(menu);
    await expect(rename).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(selection).toBeFocused();

    await selection.press("Shift+F10");
    await rename.press("Enter");

    const renameDialog = page.getByRole("dialog", { name: "重命名会话" });
    await expectPortaledOutsideSessionSidebar(renameDialog);
    await expect(renameDialog.getByRole("textbox")).toBeFocused();
    await renameDialog.getByRole("textbox").fill("E2E Session Journey Rename");
    await renameDialog.getByRole("button", { name: "保存" }).click();

    const renamedSelection = page.getByRole("button", { name: "打开会话：E2E Session Journey Rename" });
    await expect(renamedSelection).toBeVisible();
    await expect(renamedSelection).toBeFocused();
  });

  test("deletes a session through the keyboard-driven confirmation dialog", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await newSessionButton(page).click();
    const rowsBefore = page.locator("[data-session-row]");
    const countBefore = await rowsBefore.count();

    const targetRow = rowsBefore.first();
    const targetSessionId = await targetRow.getAttribute("data-session-row");
    expect(targetSessionId).toBeTruthy();
    const stableTargetRow = page.locator(`[data-session-row="${targetSessionId}"]`);
    const selection = targetRow.getByRole("button", { name: /^打开会话：/ });
    await selection.focus();
    await selection.press("Shift+F10");

    const menu = page.getByRole("menu");
    await expectPortaledOutsideSessionSidebar(menu);
    const deleteHistory = menu.getByRole("menuitem", { name: "删除历史" });
    await expect(deleteHistory).toBeVisible();
    await deleteHistory.focus();
    await expect(deleteHistory).toBeFocused();
    await deleteHistory.press("Enter");

    const confirmation = page.getByRole("dialog", { name: "删除当前会话" });
    await expectPortaledOutsideSessionSidebar(confirmation);
    const confirmButton = confirmation.getByRole("button", { name: "永久删除" });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    await expect(stableTargetRow).toHaveCount(0);
    const countAfter = await page.locator("[data-session-row]").count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  test("collapses and expands the session sidebar via the toggle button", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    const sidebar = page.locator("[data-session-sidebar]:visible");
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    const collapseButton = page.getByRole("button", { name: "收起侧栏" });
    await collapseButton.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    const expandButton = page.getByRole("button", { name: "展开侧栏" });
    await expandButton.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  test("persists sessions across a full page reload @smoke", async ({ page }) => {
    await page.goto(harness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await newSessionButton(page).click();
    const composer = workspaceComposer(page);
    await composer.fill(RealRuntimeIntegrationValues.DirectRequestInput);
    await composer.press("Enter");

    await expect(readUserMessage(page, RealRuntimeIntegrationValues.DirectRequestInput)).toBeVisible();
    await expect(readAssistantMessage(page, RealRuntimeIntegrationValues.DirectFinalAnswer)).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(workspaceComposer(page)).toBeVisible();
    await expect(readUserMessage(page, RealRuntimeIntegrationValues.DirectRequestInput)).toBeVisible();
    await expect(readAssistantMessage(page, RealRuntimeIntegrationValues.DirectFinalAnswer)).toBeVisible();
  });
});

async function expectPortaledOutsideSessionSidebar(surface) {
  await expect(surface).toBeVisible();
  expect(await surface.evaluate((element) => element.closest("[data-session-sidebar]") === null)).toBe(true);
}

async function renameActiveSession(page, title) {
  const activeIndicator = page.locator("[data-active-session-indicator]");
  if ((await activeIndicator.count()) === 0) {
    await newSessionButton(page).click();
    await expect(activeIndicator).toHaveCount(1);
  }

  const activeRow = page.locator("[data-session-row]").filter({
    has: activeIndicator,
  });
  const selection = activeRow.getByRole("button", { name: /^打开会话：/ });
  await expect(selection).toBeVisible();
  await selection.focus();
  await selection.press("Shift+F10");

  const menu = page.getByRole("menu");
  await expectPortaledOutsideSessionSidebar(menu);
  await menu.getByRole("menuitem", { name: "重命名" }).press("Enter");

  const dialog = page.getByRole("dialog", { name: "重命名会话" });
  await expectPortaledOutsideSessionSidebar(dialog);
  await dialog.getByRole("textbox").fill(title);
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("button", { name: `打开会话：${title}` })).toBeVisible();
}

function newSessionButton(page) {
  return page
    .locator("[data-session-sidebar]:visible")
    .locator("[data-window-drag-region]")
    .getByRole("button", { name: "新建对话" });
}

function workspaceComposer(page) {
  return page.getByLabel("输入消息");
}

function readUserMessage(page, content) {
  return page.getByRole("button", { name: "编辑这条消息" }).filter({ hasText: content });
}

function readAssistantMessage(page, content) {
  return page.locator("[data-assistant-message]").filter({ hasText: content });
}
