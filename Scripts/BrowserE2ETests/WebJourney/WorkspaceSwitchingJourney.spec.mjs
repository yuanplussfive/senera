import fs from "node:fs/promises";
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

async function openWorkspaceMenu(page, tab = "文件") {
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await page.getByRole("button", { name: "工具", exact: true }).click();
  await page.locator("[data-workspace-menu-trigger]").click();
  const menu = page.locator("[data-workspace-menu]");
  await menu.getByRole("tab", { name: tab, exact: true }).click();
  return menu;
}

function workspaceFolderAction(menu) {
  return menu.locator("[data-workspace-folder-action]");
}

for (const width of [390, 1280]) {
  test(`workspace file panel scrolls with the wheel through its Shadow DOM at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await Promise.all(
      Array.from({ length: 80 }, (_, index) => fs.writeFile(path.join(harness.a, `file-${index}.txt`), "Senera")),
    );
    await page.goto(harness.httpOrigin);
    const menu = await openWorkspaceMenu(page);
    const scroller = menu.locator("[data-file-tree-virtualized-scroll]:visible");
    await expect(scroller).toBeVisible();
    await expect.poll(() => scroller.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(100);
    await scroller.hover();
    await page.mouse.wheel(0, 420);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const down = await scroller.evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, -320);
    await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(down);
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
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
  await openWorkspaceMenu(page);
  await expect(page.locator("[data-workspace-menu-trigger]")).toContainText("workspace-a");
  expect(new URL(page.url()).searchParams.get("workspaceId")).not.toBe("65830d5d-a7d0-4588-883a-e3cca05c6cde");
  await page.reload();
  await expect(page.getByLabel("输入消息")).toBeEnabled();
});

test("storage settings show the actual application directory without deployment knobs", async ({ page }) => {
  await page.goto(`${harness.httpOrigin}/settings/storage`);
  const settings = page.locator("[data-settings-workbench]");
  await expect(settings).toBeVisible();
  await expect(settings.getByText(harness.applicationRoot, { exact: true })).toBeVisible();
  await expect(settings.getByTitle(harness.a, { exact: true })).toBeVisible();
  await expect(settings.getByText("插件目录", { exact: true })).toHaveCount(0);
  await expect(settings.getByText("产物目录", { exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "刷新存储占用", exact: true })).toBeEnabled();
});

test("switches real workspace scopes and restores the original composer draft", async ({ page }) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await page.getByLabel("输入消息").fill("工作区 A 的草稿");
  const selector = await openWorkspaceMenu(page, "切换");
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
  const recent = await openWorkspaceMenu(page, "切换");
  await expect(page.locator("[data-workspace-menu-trigger]")).toContainText("workspace-b");
  await recent.getByRole("button").filter({ hasText: "workspace-a" }).click();
  await expect(page.getByLabel("输入消息")).toHaveValue("工作区 A 的草稿");
  await page.reload();
  await expect(page.getByLabel("输入消息")).toHaveValue("工作区 A 的草稿");
});

test("searches, previews, watches and attaches real workspace files", async ({ page }) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await openWorkspaceMenu(page);
  const tree = page.locator("[data-workspace-file-tree]");
  await tree.getByPlaceholder("搜索当前工作区文件").fill("example");
  await tree.locator('[role="treeitem"][data-item-path="src/example.txt"]:visible').click();
  const preview = page.getByRole("dialog", { name: "example.txt", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.locator("diffs-container")).toContainText("工作区 A 的文件");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await fs.writeFile(path.join(harness.a, "src", "example.txt"), "实时修改后的文件\n");
  await expect(preview.locator("diffs-container")).toContainText("实时修改后的文件");
  const upload = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/resources" && response.request().method() === "POST",
  );
  await preview.getByRole("button", { name: "引用到对话", exact: true }).click();
  const uploaded = await upload;
  expect(uploaded.status()).toBe(200);
  const payload = await uploaded.json();
  const contentUrl = new URL(`/api/resources${new URL(payload.resources[0].resourceUri).pathname}`, uploaded.url());
  contentUrl.search = new URL(uploaded.url()).search;
  const content = await page.request.get(contentUrl.toString());
  expect(content.status()).toBe(200);
  expect(await content.text()).toBe("实时修改后的文件\n");
  await expect(preview).toBeHidden();
  await expect(page.locator("[data-chat-composer]")).toContainText("example.txt");
});

for (const width of [390, 900, 1280, 1440, 1600]) {
  test(`workspace selector and browser fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harness.httpOrigin);
    await expect(page.getByLabel("输入消息")).toBeVisible();
    const selector = await openWorkspaceMenu(page, "切换");
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
    await openWorkspaceMenu(page, "切换");
    await workspaceFolderAction(selector).click();
    await expect(browser.getByRole("button", { name: "src", exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}-dark.png`) });
  });
}

async function openFile(page, file) {
  await openWorkspaceMenu(page);
  const tree = page.locator("[data-workspace-file-tree]");
  await tree.getByPlaceholder("搜索当前工作区文件").fill(file);
  await tree.locator(`[role="treeitem"][data-item-path="${file}"]:visible`).click();
  const preview = page.getByRole("dialog").filter({ has: page.locator("[data-workspace-text-surface]") });
  const name = file.split(/[\\/]/u).at(-1) ?? file;
  await expect(preview.locator(".resource-header")).toContainText(name);
  await expect
    .poll(() =>
      preview.locator("[data-dialog-panel='true']").evaluate((node) => Number(getComputedStyle(node).opacity)),
    )
    .toBeGreaterThan(0.98);
  return preview;
}

test("directory browser supports child, parent, repeated browse and error recovery", async ({ page }) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const selector = await openWorkspaceMenu(page, "切换");
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

test("a failed highlight worker reports an error and can be explicitly retried", async ({ page }) => {
  const workerUrl = "**/assets/worker-*.js";
  await page.route(workerUrl, (route) => route.abort("failed"));
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const preview = await openFile(page, "src/example.ts");
  await expect(preview.getByRole("alert")).toBeVisible();
  await expect(preview.locator("diffs-container")).toHaveCount(0);
  await page.unroute(workerUrl);
  await preview.getByRole("button", { name: "重试", exact: true }).click();
  await expect(preview.locator("diffs-container")).toContainText("Hello Senera");
  await expect(preview.getByRole("alert")).toHaveCount(0);
});

test("cold source render is highlighted and large files keep a bounded interactive viewport", async ({
  page,
}, testInfo) => {
  const lines = 12_000;
  await fs.writeFile(
    path.join(harness.a, "src", "large.ts"),
    Array.from({ length: lines }, (_, index) => `export const value${index} = "Senera line ${index}";`).join("\n"),
  );
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const preview = await openFile(page, "src/large.ts");
  const code = preview.locator("diffs-container");
  await expect(code).toContainText("Senera line 0");
  await expect
    .poll(() =>
      code.evaluate((host) => {
        const tokens = Array.from(host.shadowRoot.querySelectorAll("[data-code] span"));
        return new Set(tokens.map((token) => getComputedStyle(token).color)).size;
      }),
    )
    .toBeGreaterThan(1);
  const scroller = preview.locator("[data-workspace-code] .scrollbar-thin");
  expect(await scroller.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe("thin");
  expect(
    await code.evaluate((host) => {
      const node = host.shadowRoot.querySelector("[data-code]");
      return getComputedStyle(node).scrollbarWidth;
    }),
  ).toBe("thin");
  expect(await code.locator("[data-line]").count()).toBeLessThan(600);
  expect(await scroller.evaluate((node) => node.scrollHeight)).toBeGreaterThan(lines * 20);
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(code).toContainText(`Senera line ${lines - 1}`);
  expect(await code.locator("[data-line]").count()).toBeLessThan(600);
  await preview.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(preview.getByRole("textbox", { name: "large.ts", exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "取消", exact: true }).click();
  await expect(preview.locator("[data-workspace-text-surface]")).toHaveAttribute("data-editing", "false");
  await page.screenshot({ path: testInfo.outputPath("workspace-large-source.png") });
});

test("file selection aborts stale loads and invalid JSON reports its structure error", async ({ page }) => {
  await fs.writeFile(path.join(harness.a, "invalid.json"), '{ "broken": }');
  let requested;
  const loading = new Promise((resolve) => {
    requested = resolve;
  });
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/resources?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("path") !== "src/example.ts") return route.continue();
    requested();
    await delayed;
    await route.continue().catch(() => {});
  });
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  await openWorkspaceMenu(page);
  const tree = page.locator("[data-workspace-file-tree]");
  await tree.getByPlaceholder("搜索当前工作区文件").fill("src/example.ts");
  await tree.locator('[role="treeitem"][data-item-path="src/example.ts"]:visible').click();
  await loading;
  const preview = page.getByRole("dialog").filter({ has: page.locator("[data-workspace-explorer]") });
  const explorer = preview.locator("[data-workspace-explorer]");
  await explorer.getByPlaceholder("搜索当前工作区文件").fill("invalid.json");
  await explorer.locator('[role="treeitem"][data-item-path="invalid.json"]:visible').click();
  await expect(preview.locator("diffs-container")).toContainText("broken");
  release();
  await preview.getByRole("button", { name: "预览: 源码", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "结构", exact: true }).click();
  await expect(preview.locator("[data-workspace-text-surface]")).toContainText("JSON");
  await expect(preview.locator(".resource-header")).toContainText("invalid.json");
});

test("native editor saves, discards and protects against external version conflicts", async ({ page }) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const preview = await openFile(page, "src/example.ts");
  const surface = preview.locator("[data-workspace-text-surface]");
  await expect(surface).toHaveAttribute("data-editing", "false");
  await preview.getByRole("button", { name: "编辑", exact: true }).click();
  const input = preview.getByRole("textbox", { name: "example.ts", exact: true });
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("// saved through Pierre\n");
  await preview.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(surface).toHaveAttribute("data-editing", "false");
  expect(await fs.readFile(path.join(harness.a, "src/example.ts"), "utf8")).toContain("saved through Pierre");

  await preview.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.focus();
  await page.keyboard.insertText("UNSAVED");
  await preview.getByRole("button", { name: "取消", exact: true }).click();
  await expect(preview.getByText("文件还有未保存的修改")).toBeVisible();
  await preview.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(surface).toHaveAttribute("data-editing", "false");
  await expect(preview.locator("diffs-container")).not.toContainText("UNSAVED");

  await preview.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(input).toBeVisible();
  await expect(input).toBeEnabled();
  await input.focus();
  await page.keyboard.insertText("CONFLICT");
  await fs.writeFile(path.join(harness.a, "src/example.ts"), "// external version\n");
  await expect(preview.getByText(/文件已被外部修改/)).toBeVisible();
  await preview.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(preview.getByRole("button", { name: "保存修改", exact: true })).toBeEnabled();
  await expect(surface).toHaveAttribute("data-editing", "true");
  expect(await fs.readFile(path.join(harness.a, "src/example.ts"), "utf8")).toBe("// external version\n");
  await preview.getByRole("button", { name: "放弃修改并重新加载", exact: true }).click();
  await expect(surface).toHaveAttribute("data-editing", "false");
  await expect(preview.locator("diffs-container")).toContainText("external version");
});

test("renders Markdown and offers expandable JSON without entering edit mode", async ({ page }, testInfo) => {
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const markdown = await openFile(page, "README.md");
  await expect(markdown.getByRole("heading", { name: "Senera 工作区", exact: true })).toBeVisible();
  await expect(markdown.getByRole("list")).toContainText("原生编辑");
  await expect(markdown.getByRole("table")).toContainText("可用");
  await expect(markdown.locator(".markdown-renderer")).toContainText("Senera");
  await expect(markdown.locator(".resource-header").getByRole("button", { name: "预览", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pierre-markdown-preview.png") });
  await markdown.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(markdown).toBeHidden();
  const json = await openFile(page, "data.json");
  await expect(json.locator("diffs-container")).toContainText("Senera");
  await json.getByRole("button", { name: "预览: 源码", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "结构", exact: true }).click();
  await expect(json.locator(".workspace-json-tree")).toContainText("Senera");
  await expect(json.locator("[data-workspace-text-surface]")).toHaveAttribute("data-editing", "false");
  await expect(json.locator(".resource-header").getByRole("button", { name: "预览: 结构", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pierre-json-preview.png") });
});

test("resource workbench scrolls its explorer and Markdown surface with the wheel", async ({ page }) => {
  await Promise.all(
    Array.from({ length: 80 }, (_, index) => fs.writeFile(path.join(harness.a, `resource-${index}.txt`), "Senera")),
  );
  await fs.writeFile(
    path.join(harness.a, "long-preview.md"),
    Array.from({ length: 180 }, (_, index) => `## Senera section ${index}\n\nPreview line ${index}.`).join("\n\n"),
  );
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const preview = await openFile(page, "long-preview.md");
  const explorerScroller = preview.locator("[data-workspace-explorer] [data-file-tree-virtualized-scroll]:visible");
  await expect(explorerScroller).toBeVisible();
  await expect
    .poll(() => explorerScroller.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(100);
  await explorerScroller.hover();
  await page.mouse.wheel(0, 420);
  await expect.poll(() => explorerScroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  const markdownScroller = preview.locator("[data-workspace-text-surface] > .scrollbar-thin");
  await expect(markdownScroller).toBeVisible();
  await expect
    .poll(() => markdownScroller.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(100);
  await markdownScroller.hover();
  await page.mouse.wheel(0, 420);
  await expect.poll(() => markdownScroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(preview).toBeVisible();
});

test("file preview follows the actual dark appearance preference", async ({ page }, testInfo) => {
  await useDarkAppearance(page);
  await page.goto(harness.httpOrigin);
  await expect(page.getByLabel("输入消息")).toBeEnabled();
  const preview = await openFile(page, "README.md");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(preview.getByRole("heading", { name: "Senera 工作区", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("pierre-markdown-dark.png") });
});

for (const width of [390, 900, 1280, 1440, 1600]) {
  test(`Pierre file workbench fits ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harness.httpOrigin);
    await expect(page.getByLabel("输入消息")).toBeEnabled();
    const preview = await openFile(page, "src/example.ts");
    await expect(preview.locator("diffs-container")).toContainText("Hello Senera");
    const panel = preview.locator("[data-dialog-panel]");
    const bounds = await panel.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width === 390) {
      await preview.getByRole("button", { name: "显示或隐藏文件树", exact: true }).click();
      await expect(preview.locator("[data-workspace-explorer]")).toBeVisible();
      await preview.locator('[role="treeitem"][data-item-path="src/example.ts"]:visible').click();
      await expect(preview.locator("[data-workspace-explorer]")).toBeHidden();
    }
    await page.screenshot({ path: testInfo.outputPath(`pierre-workbench-${width}.png`) });
    await useDarkAppearance(page);
    await page.reload();
    await expect(page.getByLabel("输入消息")).toBeEnabled();
    const darkPreview = await openFile(page, "src/example.ts");
    await expect(darkPreview.locator("diffs-container")).toContainText("Hello Senera");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pierre-workbench-${width}-dark.png`) });
  });
}
