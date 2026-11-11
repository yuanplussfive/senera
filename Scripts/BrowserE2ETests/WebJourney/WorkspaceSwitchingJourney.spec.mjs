import path from "node:path";
import { expect, test } from "../browserE2eTest.mjs";
import { createWorkspaceHostHarness } from "../workspaceHostHarness.mjs";

let harness;
test.beforeEach(async () => {
  harness = await createWorkspaceHostHarness();
});
test.afterEach(async ({ page }) => {
  await page.close();
  await harness?.stop();
});

async function useDarkAppearance(page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "senera.appearancePreference",
      JSON.stringify({
        themeMode: "dark",
        colorScheme: "classic",
        accentColor: "sky",
        fontFamily: "brand",
        fontScale: "standard",
      }),
    ),
  );
}

async function openWorkspaceSwitcher(page) {
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const trigger = page.locator('[data-execution-context-part="workspace"]');
  await trigger.click();
  const switcher = page.locator("[data-workspace-switcher]");
  await expect(switcher).toBeVisible();
  return switcher;
}

function workspaceFolderAction(menu) {
  return menu.locator("[data-workspace-folder-action]");
}

test("an obsolete workspace URL stops reconnecting and can open a registered folder", async ({ page }) => {
  const connections = [];
  page.on("websocket", (socket) => connections.push(socket.url()));
  await page.goto(`${harness.httpOrigin}/?workspaceId=65830d5d-a7d0-4588-883a-e3cca05c6cde`);
  const recovery = page.locator("[data-workspace-recovery]");
  await expect(recovery.getByText("工作区已失效", { exact: true })).toBeVisible();
  const open = recovery.getByRole("button", { name: /workspace-a/ });
  await expect(open).toBeVisible();
  expect(
    connections.every((url) => new URL(url).searchParams.get("workspaceId") === "65830d5d-a7d0-4588-883a-e3cca05c6cde"),
  ).toBe(true);
  await open.click();
  await expect(recovery).toBeHidden();
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await openWorkspaceSwitcher(page);
  await expect(page.locator('[data-execution-context-part="workspace"]')).toContainText("workspace-a");
  expect(new URL(page.url()).searchParams.get("workspaceId")).not.toBe("65830d5d-a7d0-4588-883a-e3cca05c6cde");
  await page.reload();
  await expect(page.getByLabel("输入消息")).toBeEnabled();
});

test("retired storage links open About without the removed storage surface", async ({ page }) => {
  await page.goto(`${harness.httpOrigin}/settings/storage`);
  const settings = page.locator("[data-settings-workbench]");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Senera", exact: true })).toBeVisible();
  // Storage usage moved behind the development-only About diagnostics; the
  // production build must not render the removed settings section or its table.
  await expect(settings.getByText("存储占用", { exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "刷新存储占用", exact: true })).toHaveCount(0);
});

test("switches real workspace scopes and restores the original composer draft", async ({ page }) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await page.getByLabel("输入消息").fill("工作区 A 的草稿");
  const selector = await openWorkspaceSwitcher(page);
  await workspaceFolderAction(selector).click();
  const browser = page.getByRole("dialog", { name: "切换工作区", exact: true });
  await browser.getByLabel("目标工作区目录").fill(harness.b);
  await browser.getByRole("button", { name: "浏览", exact: true }).click();
  await expect(browser.getByLabel("目标工作区目录")).toHaveValue(harness.b);
  await expect(browser.getByRole("button", { name: "打开此文件夹" })).toBeEnabled();
  await browser.getByRole("button", { name: "打开此文件夹" }).click();
  await expect(page).toHaveURL(/workspaceId=/);
  await expect(page.getByLabel("输入消息")).toHaveValue("");
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const recent = await openWorkspaceSwitcher(page);
  await expect(page.locator('[data-execution-context-part="workspace"]')).toContainText("workspace-b");
  await recent.getByRole("button").filter({ hasText: "workspace-a" }).click();
  await expect(page.getByLabel("输入消息")).toHaveValue("工作区 A 的草稿");
  await page.reload();
  await expect(page.getByLabel("输入消息")).toHaveValue("工作区 A 的草稿");
});

for (const width of [390, 900, 1280, 1440, 1600]) {
  test(`workspace selector and browser fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harness.httpOrigin);
    await expect(page.getByLabel("输入消息")).toBeVisible();
    const selector = await openWorkspaceSwitcher(page);
    await expect(workspaceFolderAction(selector)).toBeEnabled();
    await workspaceFolderAction(selector).click();
    const browser = page.getByRole("dialog", { name: "切换工作区", exact: true });
    await expect(browser.getByRole("button", { name: "src", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(browser).toBeHidden();
    await useDarkAppearance(page);
    await page.reload();
    const darkSelector = await openWorkspaceSwitcher(page);
    await workspaceFolderAction(darkSelector).click();
    await expect(browser.getByRole("button", { name: "src", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}-dark.png`) });
  });
}

test("directory browser supports child, parent, repeated browse and error recovery", async ({ page }) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const selector = await openWorkspaceSwitcher(page);
  await workspaceFolderAction(selector).click();
  const browser = page.getByRole("dialog", { name: "切换工作区", exact: true });
  const directory = browser.getByLabel("目标工作区目录");
  await expect(browser.getByRole("button", { name: "src", exact: true })).toBeVisible();
  await browser.getByRole("button", { name: "src", exact: true }).click();
  await expect(directory).toHaveValue(path.join(harness.a, "src"));
  await browser.getByRole("button", { name: "上一级", exact: true }).click();
  await expect(directory).toHaveValue(harness.a);
  for (let index = 0; index < 2; index++) {
    const response = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/workspace-directories");
    await browser.getByRole("button", { name: "浏览", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(browser.getByRole("button", { name: "src", exact: true })).toBeVisible();
  }
  await directory.fill(path.join(harness.b, "missing"));
  await directory.press("Enter");
  await expect(browser.getByRole("alert")).toBeVisible();
  await expect(browser.getByRole("button", { name: "打开此文件夹" })).toBeDisabled();
  await directory.fill(harness.b);
  await browser.getByRole("button", { name: "浏览", exact: true }).click();
  await expect(browser.getByRole("alert")).toHaveCount(0);
  await expect(browser.getByRole("button", { name: "打开此文件夹" })).toBeEnabled();
  await browser.getByRole("button", { name: "打开此文件夹" }).click();
  await expect(browser).toBeHidden();
  await expect(page.getByLabel("输入消息")).toBeEnabled();
});
