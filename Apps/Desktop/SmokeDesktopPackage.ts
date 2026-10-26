import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { isMainModule } from "../../Source/AgentSystem/Core/AgentPath.js";

/**
 * Launches the packaged desktop application and exercises the paths that only exist
 * once it is packaged: resource resolution through `process.resourcesPath`, the
 * `file://` frontend document, the utility-process server, first-start workspace
 * initialization, and renderer crash recovery. Development runs never reach these,
 * so the release chain runs this after `electron-builder` and before publication.
 */
const workspaceRoot = process.cwd();
const packagedExecutable = path.join(workspaceRoot, "Release", "win-unpacked", "Senera.exe");
const DesktopSmokeWindowTimeoutMs = 120_000;
const DesktopSmokeLogTimeoutMs = 60_000;

if (isMainModule(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  assert.equal(
    process.platform,
    "win32",
    "The desktop package smoke covers the Windows release chain; other platforms have no packaged artifact to launch.",
  );
  assert.ok(
    fs.existsSync(packagedExecutable),
    `Packaged desktop executable is missing: ${packagedExecutable}. Run electron-builder before the smoke.`,
  );

  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-workspace-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-data-"));
  const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-lock-"));
  const desktopStateRoot = path.join(workspacePath, ".senera", "desktop");
  const logPath = path.join(desktopStateRoot, "desktop.log");
  const sessionMarkerPath = path.join(desktopStateRoot, "desktop.session");
  const serverPort = await findAvailablePort();
  const webSockets: string[] = [];
  let launched: ElectronApplication | undefined;

  try {
    const desktopApplication = await electron.launch({
      executablePath: packagedExecutable,
      timeout: DesktopSmokeWindowTimeoutMs,
      // The single-instance lock is taken from Electron's user data directory before the
      // app redirects it into the workspace, so a desktop instance that is already running
      // would make this launch exit silently. Only the lock directory is redirected here.
      args: [`--user-data-dir=${lockRoot}`],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        // A fresh workspace directory and a fresh data root make this the first start:
        // no persisted workspace selection exists, so the picker would block the launch.
        SENERA_WORKSPACE_ROOT: workspacePath,
        SENERA_DATA_ROOT: dataRoot,
        SENERA_SERVER_PORT: String(serverPort),
      },
    });
    launched = desktopApplication;
    desktopApplication.on("window", (page) => collectWebSockets(page, webSockets));

    const mainWindow = await desktopApplication.firstWindow({ timeout: DesktopSmokeWindowTimeoutMs });
    collectWebSockets(mainWindow, webSockets);
    await mainWindow
      .locator("[data-workspace-main]")
      .waitFor({ state: "visible", timeout: DesktopSmokeWindowTimeoutMs });

    const windowTitles = await desktopApplication.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.getTitle()),
    );
    assert.ok(
      windowTitles.includes("Senera"),
      `The main window title must be Senera, got ${JSON.stringify(windowTitles)}.`,
    );
    assert.equal(
      await mainWindow.evaluate(() => (window.seneraDesktop as { isDesktop?: boolean } | undefined)?.isDesktop),
      true,
      "The packaged window must expose the desktop preload bridge.",
    );

    const webSocketUrl = new URL(mainWindow.url()).searchParams.get("webSocketUrl");
    assert.ok(webSocketUrl, "The packaged window URL must carry the workspace websocket URL.");
    await waitForCondition(
      () => webSockets.some((url) => new URL(url).host === new URL(webSocketUrl).host),
      DesktopSmokeLogTimeoutMs,
      `The renderer must open the workspace websocket ${webSocketUrl}; saw ${JSON.stringify(webSockets)}.`,
    );

    const readyLine = await waitForLogLine(logPath, /desktop ready in \d+ms server=\d+ms frontend=\d+ms/u);
    const log = fs.readFileSync(logPath, "utf8");
    assert.ok(!log.includes("startup failed"), `The packaged startup must not fail:\n${log}`);
    assert.ok(
      fs.existsSync(path.join(workspacePath, "senera.config.json")),
      "The first start must seed the workspace configuration from the packaged example.",
    );
    await waitForCondition(
      () => fs.existsSync(sessionMarkerPath),
      DesktopSmokeLogTimeoutMs,
      "A ready session must leave the shutdown marker that the next start reads.",
    );

    const settingsWindowPromise = desktopApplication.waitForEvent("window", { timeout: DesktopSmokeWindowTimeoutMs });
    await mainWindow.evaluate(() => window.seneraDesktop?.openSettings({ section: "appearance" }));
    const settingsWindow = await settingsWindowPromise;
    collectWebSockets(settingsWindow, webSockets);
    await settingsWindow
      .locator("[data-settings-workbench]")
      .waitFor({ state: "visible", timeout: DesktopSmokeWindowTimeoutMs });
    assert.match(
      settingsWindow.url(),
      /section=appearance/u,
      "The packaged settings window must open the requested section instead of a normalized fallback.",
    );

    await desktopApplication.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.forcefullyCrashRenderer();
    });
    await waitForLogLine(logPath, /renderer process gone window=/u);
    await waitForLogLine(logPath, /reloading renderer window=/u);
    // Playwright keeps a crashed page unusable, so recovery is observed through the main
    // process: both windows must render their surface again in the reloaded document.
    await waitForCondition(
      async () => {
        const surfaces = await readRenderedSurfaces(desktopApplication).catch(() => []);
        return surfaces.length === 2 && surfaces.every((surface) => surface.endsWith(":rendered"));
      },
      DesktopSmokeWindowTimeoutMs,
      "Both windows must render their surface again after the renderer crash.",
    );

    // A clean quit clears the marker; leaving it behind is what makes the next start
    // report a crash. `app.quit()` is the app's own shutdown path, not a teardown kill.
    await desktopApplication.evaluate(({ app }) => app.quit()).catch(() => {});
    await waitForCondition(
      () => !fs.existsSync(sessionMarkerPath),
      DesktopSmokeLogTimeoutMs,
      "A clean quit must remove the desktop session marker.",
    );
    await desktopApplication.close().catch(() => {});
    launched = undefined;

    process.stdout.write(
      [
        "Desktop package smoke passed.",
        `  executable=${packagedExecutable}`,
        `  workspace=${workspacePath}`,
        `  ${readyLine}`,
        `  websocket=${webSocketUrl}`,
      ].join("\n") + "\n",
    );
  } catch (error) {
    reportDesktopLog(logPath);
    throw error;
  } finally {
    await launched?.close().catch(() => {});
    fs.rmSync(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    fs.rmSync(lockRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function collectWebSockets(page: Page, webSockets: string[]): void {
  page.on("websocket", (socket) => webSockets.push(socket.url()));
}

/**
 * A crashed page cannot be reused by Playwright, so renderer recovery is read from the
 * main process instead: the reloaded document has to render its surface again.
 */
async function readRenderedSurfaces(application: ElectronApplication): Promise<string[]> {
  return application.evaluate(async ({ BrowserWindow }) =>
    Promise.all(
      BrowserWindow.getAllWindows().map(async (window) => {
        const rendered = await window.webContents.executeJavaScript(
          "Boolean(document.querySelector('[data-workspace-main], [data-settings-workbench]'))",
        );
        return `${window.getTitle()}:${rendered ? "rendered" : "empty"}`;
      }),
    ),
  );
}

function reportDesktopLog(logPath: string): void {
  if (!fs.existsSync(logPath)) {
    process.stderr.write(
      `desktop.log was not created: ${logPath}\n` +
        "The application exited before it reached its workspace; a desktop instance holding the single-instance lock does this.\n",
    );
    return;
  }
  process.stderr.write(`desktop.log (${logPath}):\n${fs.readFileSync(logPath, "utf8")}\n`);
}

async function waitForLogLine(logPath: string, pattern: RegExp): Promise<string> {
  let line: string | undefined;
  await waitForCondition(
    () => {
      if (!fs.existsSync(logPath)) return false;
      line = fs
        .readFileSync(logPath, "utf8")
        .split("\n")
        .find((entry) => pattern.test(entry));
      return line !== undefined;
    },
    DesktopSmokeLogTimeoutMs,
    `desktop.log must record ${pattern}.`,
  );
  return line ?? "";
}

async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  description: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`Timed out after ${timeoutMs}ms: ${description}`);
}

/** The packaged app binds a real port, and a dev server may already hold the default one. */
async function findAvailablePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object", "The port probe must report a bound address.");
  await promisify(server.close).bind(server)();
  return address.port;
}
