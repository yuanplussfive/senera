import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { createBrowserE2eHarness } from "../browserE2eTest.mjs";

let desktopApplication;
let desktopPage;
let harness;
let userDataRoot;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  harness = await createBrowserE2eHarness({ authenticationMode: "disabled" });
  userDataRoot = mkdtempSync(path.join(os.tmpdir(), "senera-desktop-browser-e2e-"));
  desktopApplication = await electron.launch({
    chromiumSandbox: true,
    args: [path.resolve("Scripts", "BrowserE2ETests", "DesktopJourney", "electronDesktopHarness.cjs")],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      SENERA_BROWSER_E2E_HTTP_ORIGIN: harness.httpOrigin,
      SENERA_BROWSER_E2E_USER_DATA_ROOT: userDataRoot,
    },
  });
  desktopPage = await desktopApplication.firstWindow();
});

test.afterAll(async () => {
  await desktopApplication?.close();
  await harness?.stop();
  if (userDataRoot) {
    rmSync(userDataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("loads the desktop settings surface through the real Electron preload bridge @smoke", async () => {
  const failures = [];
  desktopPage.on("pageerror", (error) => failures.push(`pageerror: ${error.stack ?? error.message}`));
  desktopPage.on("response", (response) => {
    if (response.status() >= 500) failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await expect(desktopPage.locator("[data-settings-workbench]")).toBeVisible();
  await expect(desktopPage.getByRole("heading", { level: 2, name: "外观" })).toBeVisible();
  expect(
    await desktopPage.evaluate(() => ({
      desktopSurface: document.documentElement.dataset.seneraDesktopSurface,
      isDesktop: window.seneraDesktop?.isDesktop,
    })),
  ).toEqual({ desktopSurface: "settings", isDesktop: true });
  expect(failures, failures.join("\n")).toEqual([]);
});
