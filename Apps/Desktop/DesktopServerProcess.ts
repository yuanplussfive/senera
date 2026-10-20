import process from "node:process";
import { startSeneraServer, SeneraServerDeployments, type SeneraServerHandle } from "../ServerRuntime.js";
import { projectDesktopRuntimeConfig } from "./DesktopRuntimeConfig.js";
import {
  DesktopServerParentMessageKinds,
  DesktopServerProcessMessageKinds,
  type DesktopServerBootstrap,
  type DesktopServerParentMessage,
  type DesktopServerProcessMessage,
  type DesktopServerSnapshot,
} from "./DesktopServerProcessProtocol.js";

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Desktop server process requires an Electron utility-process parent port.");

let server: SeneraServerHandle | undefined;
let starting = false;
let stopping = false;

parentPort.on("message", (event) => {
  void receiveMessage(event.data).catch((error: unknown) => {
    postMessage({ kind: DesktopServerProcessMessageKinds.Failed, message: errorMessage(error) });
  });
});

async function receiveMessage(message: unknown): Promise<void> {
  if (!isDesktopServerParentMessage(message)) {
    postMessage({
      kind: DesktopServerProcessMessageKinds.Failed,
      message: "Desktop server process received an invalid command.",
    });
    return;
  }
  switch (message.kind) {
    case DesktopServerParentMessageKinds.Start:
      await start(message.bootstrap);
      return;
    case DesktopServerParentMessageKinds.Stop:
      await stop(message.requestId);
      return;
  }
}

async function start(bootstrap: DesktopServerBootstrap): Promise<void> {
  if (server || starting) {
    postMessage({
      kind: DesktopServerProcessMessageKinds.Failed,
      message: "Desktop server process is already started.",
    });
    return;
  }
  starting = true;
  try {
    server = await startSeneraServer({
      workspaceRoot: bootstrap.workspaceRoot,
      applicationStateRoot: bootstrap.applicationStateRoot,
      applicationRoot: bootstrap.applicationRoot,
      resourcesPath: bootstrap.resourcesRoot,
      upgradeStateRoot: bootstrap.upgradeStateRoot,
      upgradeDataRoots: bootstrap.upgradeDataRoots,
      configSource: { kind: "json", configPath: bootstrap.configPath },
      legacyConfigPath: bootstrap.legacyConfigPath,
      deployment: SeneraServerDeployments.Local,
      runtimeConfigProjection: projectDesktopRuntimeConfig,
      automaticLoopbackHttp: true,
      onWorkspaceOpened: (workspaceRoot, workspaceId) => {
        postMessage({ kind: DesktopServerProcessMessageKinds.WorkspaceOpened, workspaceRoot, workspaceId });
      },
    });
    postMessage({ kind: DesktopServerProcessMessageKinds.Ready, snapshot: snapshot(server) });
  } catch (error) {
    postMessage({ kind: DesktopServerProcessMessageKinds.Failed, message: errorMessage(error) });
  } finally {
    starting = false;
  }
}

async function stop(requestId: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await server?.stop();
    server = undefined;
    postMessage({ kind: DesktopServerProcessMessageKinds.Stopped, requestId });
  } catch (error) {
    postMessage({ kind: DesktopServerProcessMessageKinds.Failed, requestId, message: errorMessage(error) });
  } finally {
    stopping = false;
  }
}

function snapshot(handle: SeneraServerHandle): DesktopServerSnapshot {
  return {
    workspaceRoot: handle.workspaceRoot,
    configPath: handle.configPath,
    websocketUrl: handle.websocketUrl,
    healthUrl: handle.healthUrl,
  };
}

function postMessage(message: DesktopServerProcessMessage): void {
  parentPort.postMessage(message);
}

function isDesktopServerParentMessage(value: unknown): value is DesktopServerParentMessage {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const message = value as { kind?: unknown; requestId?: unknown; workspaceRoot?: unknown; bootstrap?: unknown };
  if (message.kind === DesktopServerParentMessageKinds.Start) return isDesktopServerBootstrap(message.bootstrap);
  return message.kind === DesktopServerParentMessageKinds.Stop && isNonEmptyString(message.requestId);
}

function isDesktopServerBootstrap(value: unknown): value is DesktopServerBootstrap {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesktopServerBootstrap>;
  return (
    [
      candidate.workspaceRoot,
      candidate.applicationStateRoot,
      candidate.applicationRoot,
      candidate.resourcesRoot,
      candidate.upgradeStateRoot,
      candidate.configPath,
      candidate.legacyConfigPath,
    ].every(isNonEmptyString) &&
    Array.isArray(candidate.upgradeDataRoots) &&
    candidate.upgradeDataRoots.every(isNonEmptyString)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
