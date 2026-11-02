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
import { resolveAgentWorkspaceLayout } from "../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { readAgentRecordOrThrow } from "../../Source/AgentSystem/Core/AgentUnknownValue.js";
import { AgentEventKinds } from "../../Source/AgentSystem/Events/AgentEvent.js";

/**
 * Launches the packaged desktop application and exercises the paths that only exist
 * once it is packaged: resource resolution through `process.resourcesPath`, the
 * same-origin frontend document, the utility-process server, first-start workspace
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

  // The unpacked artifact lives below the repository while packaging runs. A module
  // lookup can therefore accidentally climb to the repository's node_modules and
  // hide a missing production dependency. Launch a physical copy outside the tree
  // so this exercises the same resolution boundary as an installed application.
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-package-"));
  const isolatedPackageRoot = path.join(packageRoot, "Senera");
  fs.cpSync(path.dirname(packagedExecutable), isolatedPackageRoot, { recursive: true });
  const isolatedExecutable = path.join(isolatedPackageRoot, path.basename(packagedExecutable));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-workspace-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-data-"));
  const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-smoke-lock-"));
  const workspaceLayout = resolveAgentWorkspaceLayout(workspacePath);
  const desktopStateRoot = workspaceLayout.desktopRuntimeRoot;
  const logPath = path.join(desktopStateRoot, "desktop.log");
  const sessionMarkerPath = path.join(desktopStateRoot, "desktop.session");
  const serverPort = await findAvailablePort();
  const webSockets: string[] = [];
  const readyWebSockets = new Set<string>();
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.SENERA_DESKTOP_FRONTEND_URL;
  let launched: ElectronApplication | undefined;

  try {
    // Desktop takes its listener from workspace configuration; SENERA_SERVER_PORT
    // belongs to the Docker entrypoint and does not override desktop settings.
    const templatePath = path.join(path.dirname(isolatedExecutable), "resources", "senera.config.example.json");
    const seed = readAgentRecordOrThrow(JSON.parse(fs.readFileSync(templatePath, "utf8")), "Packaged config template");
    const defaults = readAgentRecordOrThrow(seed.Defaults, "Packaged config Defaults");
    defaults.Server = { ...readAgentRecordOrThrow(defaults.Server, "Packaged server settings"), Port: serverPort };
    fs.writeFileSync(workspaceLayout.configFile, JSON.stringify(seed));
    const desktopApplication = await electron.launch({
      executablePath: isolatedExecutable,
      timeout: DesktopSmokeWindowTimeoutMs,
      // The single-instance lock is taken from Electron's user data directory before the
      // app redirects it into the workspace, so a desktop instance that is already running
      // would make this launch exit silently. Only the lock directory is redirected here.
      args: [`--user-data-dir=${lockRoot}`],
      env: {
        ...environment,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        // A fresh workspace directory and a fresh data root make this the first start:
        // no persisted workspace selection exists, so the picker would block the launch.
        SENERA_WORKSPACE_ROOT: workspacePath,
        SENERA_DATA_ROOT: dataRoot,
      },
    });
    launched = desktopApplication;
    desktopApplication.on("window", (page) => collectWebSockets(page, webSockets, readyWebSockets));

    const mainWindow = await desktopApplication.firstWindow({ timeout: DesktopSmokeWindowTimeoutMs });
    collectWebSockets(mainWindow, webSockets, readyWebSockets);
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
      () => [...readyWebSockets].some((url) => new URL(url).host === new URL(webSocketUrl).host),
      DesktopSmokeLogTimeoutMs,
      `The renderer must receive a workspace snapshot over ${webSocketUrl}; saw ${JSON.stringify(webSockets)}.`,
    );
    const socketOrigin = new URL(webSocketUrl);
    socketOrigin.protocol = socketOrigin.protocol === "wss:" ? "https:" : "http:";
    assert.equal(new URL(mainWindow.url()).origin, socketOrigin.origin);

    const readyLine = await waitForLogLine(logPath, /desktop ready in \d+ms server=\d+ms frontend=\d+ms/u);
    const log = fs.readFileSync(logPath, "utf8");
    assert.ok(!log.includes("startup failed"), `The packaged startup must not fail:\n${log}`);
    assert.ok(
      fs.existsSync(workspaceLayout.databases.config),
      "The first start must initialize the workspace configuration database.",
    );
    await waitForCondition(
      () => fs.existsSync(sessionMarkerPath),
      DesktopSmokeLogTimeoutMs,
      "A ready session must leave the shutdown marker that the next start reads.",
    );

    const settingsWindowPromise = desktopApplication.waitForEvent("window", { timeout: DesktopSmokeWindowTimeoutMs });
    await mainWindow.evaluate(() => window.seneraDesktop?.openSettings({ section: "appearance" }));
    const settingsWindow = await settingsWindowPromise;
    collectWebSockets(settingsWindow, webSockets, readyWebSockets);
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
    // A crashed page is no longer inspectable through Playwright. Electron's main
    // process remains alive, so the reload completion events are the reliable
    // contract: each window must finish loading its replacement document.
    await waitForLogLine(logPath, /renderer reload completed window=main/u);
    await waitForLogLine(logPath, /renderer reload completed window=settings/u);

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
        `  executable=${isolatedExecutable}`,
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
    fs.rmSync(packageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function collectWebSockets(page: Page, webSockets: string[], readyWebSockets: Set<string>): void {
  page.on("websocket", (socket) => {
    webSockets.push(socket.url());
    socket.on("framereceived", ({ payload }) => {
      const frame = readAgentRecordOrThrow(JSON.parse(payload.toString()), "Desktop WebSocket frame");
      if (frame.kind === AgentEventKinds.WorkspaceSnapshot) readyWebSockets.add(socket.url());
    });
  });
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
