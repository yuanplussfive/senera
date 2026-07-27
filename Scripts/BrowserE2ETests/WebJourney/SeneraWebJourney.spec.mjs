import {
  RealRuntimeIntegrationAdmin,
  RealRuntimeIntegrationValues,
} from "../../../Dist/Scripts/IntegrationTests/RuntimeIntegration/RealRuntimeIntegrationHarness.js";
import { createBrowserE2eHarness, expect, test } from "../browserE2eTest.mjs";

let disabledHarness;
let requiredHarness;

test.describe.configure({ mode: "serial" });

test.describe("authenticationMode=disabled", () => {
  test.beforeAll(async () => {
    disabledHarness = await createBrowserE2eHarness({ authenticationMode: "disabled" });
  });

  test.afterAll(async () => {
    await disabledHarness?.stop();
  });

  test("enters the workspace without a login gate @smoke", async ({ page }) => {
    const authenticationResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/session",
    );

    await page.goto(disabledHarness.httpOrigin);

    expect(await (await authenticationResponse).json()).toMatchObject({
      ok: true,
      session: { state: "disabled" },
    });
    await expect(page.getByRole("heading", { name: "管理员登录" })).toHaveCount(0);
    await expect(workspaceComposer(page)).toBeVisible();
  });

  test("loads a /settings/... deep link in the Web settings overlay @smoke", async ({ page }) => {
    await page.goto(`${disabledHarness.httpOrigin}/settings/appearance`);

    await expect(page.locator("[data-settings-workbench]")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { level: 2, name: "外观" })).toBeVisible();
    await expect(page).toHaveURL(`${disabledHarness.httpOrigin}/settings/appearance`);
  });

  test("opens and closes the Web settings overlay from the workspace", async ({ page }) => {
    await page.goto(disabledHarness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await openProfileMenu(page);
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();

    await expect(page.locator("[data-settings-workbench]")).toBeVisible();
    await expect(page).toHaveURL(/\?settings=model-service$/);
    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.locator("[data-settings-workbench]")).toHaveCount(0);
    await expect(page).toHaveURL(`${disabledHarness.httpOrigin}/`);
  });

  test("switches providers after the real input blur chain without inventing unsaved changes", async ({ page }) => {
    await page.goto(`${disabledHarness.httpOrigin}/settings/model-service`);
    const providerRows = page.locator('button[aria-pressed="true"], button[aria-pressed="false"]');
    await expect(providerRows.first()).toBeVisible();
    expect(await providerRows.count()).toBeGreaterThan(1);

    const activeProvider = page.locator('button[aria-pressed="true"]').first();
    const activeLabel = await activeProvider.getAttribute("aria-label");
    const apiUrl = page.getByLabel("API 地址");
    await apiUrl.focus();
    await page.locator('button[aria-pressed="false"]').first().click();

    await expect(page.getByRole("dialog", { name: "当前连接还有未保存的修改" })).toHaveCount(0);
    await expect(page.locator('button[aria-pressed="true"]')).not.toHaveAttribute("aria-label", activeLabel ?? "");
    await expect(page.getByText("正在保存连接配置", { exact: true })).toHaveCount(0);
  });

  test("keeps a real invalid connection draft behind the explicit discard confirmation", async ({ page }) => {
    await page.goto(`${disabledHarness.httpOrigin}/settings/model-service`);
    const activeProvider = page.locator('button[aria-pressed="true"]').first();
    const activeLabel = await activeProvider.getAttribute("aria-label");
    const apiUrl = page.getByLabel("API 地址");

    await apiUrl.fill("not-a-url");
    await page.locator('button[aria-pressed="false"]').first().click();

    const confirmation = page.getByRole("dialog", { name: "当前连接还有未保存的修改" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("已经保存的供应商和模型不会改变");
    const continueEditing = confirmation.getByRole("button", { name: "返回继续编辑" });
    await expect(continueEditing).toBeFocused();
    await continueEditing.click();

    await expect(confirmation).toBeHidden();
    await expect(page.locator('button[aria-pressed="true"]')).toHaveAttribute("aria-label", activeLabel ?? "");
    await expect(apiUrl).toHaveValue("not-a-url");
  });

  test("keeps the workspace stable while the Web settings chunk is loading", async ({ page }) => {
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
      await page.goto(disabledHarness.httpOrigin);
      await expect(workspaceComposer(page)).toBeVisible();
      await openProfileMenu(page);
      await settingsChunkRequested;
      await page.getByRole("menuitem", { name: "设置", exact: true }).click();

      await expect(workspaceComposer(page)).toBeVisible();
      await expect(page.locator("[data-settings-loading]")).toHaveCount(0);
      await expect(page.locator("[data-settings-workbench]")).toHaveCount(0);
      await expect(page).toHaveURL(`${disabledHarness.httpOrigin}/`);

      releaseSettingsChunk();
      await expect(page.locator("[data-settings-workbench]")).toBeVisible();
      await expect(page).toHaveURL(/\?settings=model-service$/);
    } finally {
      releaseSettingsChunk();
    }
  });

  test("keeps keyboard focus across portaled profile surfaces", async ({ page }) => {
    await page.goto(disabledHarness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    const trigger = profileMenuButton(page);
    await trigger.focus();
    await trigger.press("Enter");

    const menu = page.getByRole("menu");
    const editProfile = menu.getByRole("menuitem", { name: "编辑资料" });
    await expectPortaledOutsideSessionSidebar(menu);
    await expect(editProfile).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    await editProfile.press("Enter");

    const dialog = page.getByRole("dialog", { name: "编辑资料" });
    const displayName = dialog.getByLabel("显示名称");
    await expectPortaledOutsideSessionSidebar(dialog);
    await expect(displayName).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    await editProfile.press("Enter");
    await expect(displayName).toBeFocused();

    const save = dialog.getByRole("button", { name: "保存" });
    await save.focus();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect(save).toBeFocused();

    await dialog.getByRole("button", { name: "关闭窗口" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("runs session context actions through the real keyboard event chain", async ({ page }) => {
    await page.goto(disabledHarness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();

    await newSessionButton(page).click();
    const sessionRow = page.locator("[data-session-row]").first();
    const selection = sessionRow.getByRole("button", { name: /^打开会话：/ });
    await expect(selection).toBeVisible();
    await expect(sessionRow.getByRole("button", { name: "more" })).toHaveCount(0);

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
    await renameDialog.getByRole("textbox").fill("  Browser renamed session  ");
    await renameDialog.getByRole("button", { name: "保存" }).click();

    const renamedSelection = page.getByRole("button", { name: "打开会话：Browser renamed session" });
    await expect(renamedSelection).toBeVisible();
    await expect(renamedSelection).toBeFocused();

    await renamedSelection.press("Shift+F10");
    await page.getByRole("menuitem", { name: "删除历史" }).press("Enter");

    const confirmation = page.getByRole("dialog", { name: "删除当前会话" });
    await expectPortaledOutsideSessionSidebar(confirmation);
    await confirmation.getByRole("button", { name: "永久删除" }).click();
    await expect(sessionRow).toHaveCount(0);
  });

  test("navigates the real workflow dock tabs with browser focus and arrow keys", async ({ page }) => {
    await page.goto(disabledHarness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();
    const dock = await openWorkflowDock(page);
    const executionTab = dock.getByRole("tab", { name: "执行" });
    const terminalTab = dock.getByRole("tab", { name: "终端" });

    await executionTab.focus();
    await expect(executionTab).toBeFocused();
    await executionTab.press("ArrowRight");
    await expect(terminalTab).toBeFocused();
    await expect(terminalTab).toHaveAttribute("aria-selected", "true");
    await expect(dock.locator('[data-terminal-dock="dock"]')).toBeVisible();

    await terminalTab.press("ArrowLeft");
    await expect(executionTab).toBeFocused();
    await expect(executionTab).toHaveAttribute("aria-selected", "true");
  });

  test("resizes the workflow dock by keyboard and captured pointer, then restores its width", async ({ page }) => {
    await page.goto(disabledHarness.httpOrigin);
    await expect(workspaceComposer(page)).toBeVisible();
    const dock = await openWorkflowDock(page);
    const separator = dock.getByRole("separator", { name: "调整功能坞宽度" });
    const minimum = Number(await separator.getAttribute("aria-valuemin"));
    const maximum = Number(await separator.getAttribute("aria-valuemax"));

    await separator.focus();
    await separator.press("End");
    await expect(separator).toHaveAttribute("aria-valuenow", String(maximum));
    await separator.press("Home");
    await expect(separator).toHaveAttribute("aria-valuenow", String(minimum));
    await separator.press("ArrowLeft");
    const keyboardWidth = Number(await separator.getAttribute("aria-valuenow"));
    expect(keyboardWidth).toBeGreaterThan(minimum);

    await separator.evaluate(() => {
      globalThis.__seneraWorkflowDockCaptureEvents = [];
      document.addEventListener(
        "gotpointercapture",
        (event) => {
          const target = event.target;
          globalThis.__seneraWorkflowDockCaptureEvents.push({
            type: event.type,
            captured: target instanceof Element && target.hasPointerCapture(event.pointerId),
          });
        },
        { once: true },
      );
      document.addEventListener(
        "lostpointercapture",
        (event) => {
          const target = event.target;
          globalThis.__seneraWorkflowDockCaptureEvents.push({
            type: event.type,
            captured: target instanceof Element && target.hasPointerCapture(event.pointerId),
          });
        },
        { once: true },
      );
    });
    await separator.dragTo(page.locator("[data-workspace-main]"));
    await expect.poll(async () => Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(keyboardWidth);
    await expect
      .poll(() => page.evaluate(() => globalThis.__seneraWorkflowDockCaptureEvents))
      .toEqual([
        { type: "gotpointercapture", captured: true },
        { type: "lostpointercapture", captured: false },
      ]);

    const resizedWidth = Number(await separator.getAttribute("aria-valuenow"));
    const persistedWidth = await readPersistedWorkflowDockWidth(page);
    expect(persistedWidth).toBe(resizedWidth);

    await page.reload();
    await expect(workspaceComposer(page)).toBeVisible();
    const restoredDock = await openWorkflowDock(page);
    await expect(restoredDock.getByRole("separator", { name: "调整功能坞宽度" })).toHaveAttribute(
      "aria-valuenow",
      String(resizedWidth),
    );
  });

  test("keeps the mobile viewport workspace path usable @smoke", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(disabledHarness.httpOrigin);

    await expect(workspaceComposer(page)).toBeVisible();
    await page.getByRole("button", { name: "展开侧栏" }).click();
    await expect(page.locator('[data-session-surface="panel"]')).toBeVisible();
    await expect(profileMenuButton(page)).toBeVisible();

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  });

  test("shows the application error UI when a dynamic chunk returns 404", async ({ page }) => {
    await page.route(/\/assets\/AuthenticatedSurface-[^/]+\.js(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/javascript",
        body: "// Expected Browser E2E dynamic chunk failure.",
      });
    });

    await page.goto(disabledHarness.httpOrigin);

    const alert = page.getByRole("alert");
    await expect(alert.getByRole("heading", { name: "界面暂时无法继续显示" })).toBeVisible();
    await expect(alert.getByRole("button", { name: "重新渲染" })).toBeVisible();
    await expect(alert.getByRole("button", { name: "刷新页面" })).toBeVisible();
  });
});

test.describe("authenticationMode=required", () => {
  test.beforeAll(async () => {
    requiredHarness = await createBrowserE2eHarness({ authenticationMode: "required" });
  });

  test.afterAll(async () => {
    await requiredHarness?.stop();
  });

  test("serves the production application and authenticates on the browser origin @smoke", async ({ page }) => {
    const runtimeConfigResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/senera-runtime-config.js",
    );
    const sessionRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/auth/session");
    const compressedAssetResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.startsWith("/assets/") && response.headers()["content-encoding"] === "br";
    });

    await page.goto(requiredHarness.httpOrigin);

    const [runtimeConfig, authenticationRequest, compressedAsset] = await Promise.all([
      runtimeConfigResponse,
      sessionRequest,
      compressedAssetResponse,
    ]);
    expect(new URL(authenticationRequest.url()).origin).toBe(requiredHarness.httpOrigin);
    expect(runtimeConfig.headers()["cache-control"]).toBe("no-store");
    expect(await runtimeConfig.text()).toContain("window.__SENERA_RUNTIME_CONFIG__ = {};");
    expect(compressedAsset.headers()["vary"]).toContain("Accept-Encoding");
    expect(await page.evaluate(() => window.__SENERA_RUNTIME_CONFIG__)).toEqual({});

    const webSocket = page.waitForEvent("websocket");
    await login(page);
    const connectedSocket = await webSocket;
    expect(new URL(connectedSocket.url()).host).toBe(new URL(requiredHarness.websocketUrl).host);

    const cookies = await page.context().cookies(requiredHarness.httpOrigin);
    expect(cookies.some((cookie) => cookie.httpOnly && cookie.name.length > 0)).toBe(true);
    await expect(workspaceComposer(page)).toBeVisible();
  });

  test("recovers from rejected credentials without reloading the application @smoke", async ({ page }) => {
    await page.goto(requiredHarness.httpOrigin);
    await page.getByLabel("登录用户名").fill(RealRuntimeIntegrationAdmin.loginName);
    await page.getByLabel("密码").fill("incorrect integration password");
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page.getByText("用户名或密码错误，或当前请求已被限制。")).toBeVisible();
    await expect(page.getByLabel("密码")).toHaveValue("");

    await page.getByLabel("密码").fill(RealRuntimeIntegrationAdmin.password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(workspaceComposer(page)).toBeVisible();
  });

  test("returns to the login page after logout @smoke", async ({ page }) => {
    await page.goto(requiredHarness.httpOrigin);
    await login(page);

    await openProfileMenu(page);
    await page.getByRole("menuitem", { name: "编辑资料" }).click();
    await page.getByRole("button", { name: "退出登录" }).click();

    await expect(page.getByRole("heading", { name: "管理员登录" })).toBeVisible();
    await expect(workspaceComposer(page)).toHaveCount(0);
  });

  test("runs a real model-backed turn and restores its session after reload @smoke", async ({ page }) => {
    await page.goto(requiredHarness.httpOrigin);
    await login(page);

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

async function login(page) {
  await page.getByLabel("登录用户名").fill(RealRuntimeIntegrationAdmin.loginName);
  await page.getByLabel("密码").fill(RealRuntimeIntegrationAdmin.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(workspaceComposer(page)).toBeVisible();
}

async function openProfileMenu(page) {
  await profileMenuButton(page).click();
}

async function openWorkflowDock(page) {
  await page.locator('[data-workflow-dock-tool="execution"]').click();
  const dock = page.locator('[data-workflow-dock][data-open="true"]');
  await expect(dock).toBeVisible();
  return dock;
}

async function readPersistedWorkflowDockWidth(page) {
  return page.evaluate(() => {
    const persisted = localStorage.getItem("senera-frontend@v1");
    if (!persisted) return null;
    return JSON.parse(persisted).state?.workflowDockWidth ?? null;
  });
}

function profileMenuButton(page) {
  return visibleSessionSidebar(page).getByRole("button").filter({ hasText: "用户" });
}

function newSessionButton(page) {
  return visibleSessionSidebar(page).locator("[data-window-drag-region]").getByRole("button", { name: "新建对话" });
}

function visibleSessionSidebar(page) {
  return page.locator("[data-session-sidebar]:visible");
}

async function expectPortaledOutsideSessionSidebar(surface) {
  await expect(surface).toBeVisible();
  expect(await surface.evaluate((element) => element.closest("[data-session-sidebar]") === null)).toBe(true);
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
