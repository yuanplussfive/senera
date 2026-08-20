import type { ProgressInfo, UpdateInfo } from "builder-util-runtime";
import { app } from "electron";
import electronUpdater from "electron-updater";
import { AgentRuntimeUpdateFailureCodes } from "../../Source/AgentSystem/Runtime/AgentRuntimeUpdateContract.js";
import type { AgentRuntimeUpdateOrigin } from "../../Source/AgentSystem/Runtime/AgentRuntimeUpdateOrigin.js";
import { DesktopUpdateStates, type DesktopUpdateSnapshot, type DesktopUpdateState } from "./DesktopUpdateProtocol.js";

const { autoUpdater } = electronUpdater;

export interface DesktopUpdateServiceOptions {
  readonly isPackaged: boolean;
  readonly currentVersion?: string;
  readonly updateOrigin?: AgentRuntimeUpdateOrigin;
  readonly publishLog?: (message: string) => void;
  readonly onStateChanged?: (snapshot: DesktopUpdateSnapshot) => void;
}

export class DesktopUpdateService {
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly updateOrigin?: AgentRuntimeUpdateOrigin;
  private readonly publishLog: (message: string) => void;
  private readonly onStateChanged?: (snapshot: DesktopUpdateSnapshot) => void;
  private snapshot: DesktopUpdateSnapshot;
  private checkPromise?: Promise<DesktopUpdateSnapshot>;
  private downloadPromise?: Promise<DesktopUpdateSnapshot>;

  constructor(options: DesktopUpdateServiceOptions) {
    this.currentVersion = options.currentVersion ?? app.getVersion();
    this.isPackaged = options.isPackaged;
    this.updateOrigin = options.updateOrigin;
    this.publishLog = options.publishLog ?? (() => undefined);
    this.onStateChanged = options.onStateChanged;
    this.snapshot = {
      state: this.isPackaged && this.updateOrigin ? DesktopUpdateStates.Idle : DesktopUpdateStates.Unsupported,
      currentVersion: this.currentVersion,
    };

    if (this.isPackaged) this.bindUpdater();
    if (this.isPackaged && this.updateOrigin) this.configureUpdaterFeed(this.updateOrigin);
  }

  getSnapshot(): DesktopUpdateSnapshot {
    return { ...this.snapshot };
  }

  async start(): Promise<void> {
    if (this.isPackaged && this.updateOrigin) await this.checkForUpdates();
  }

  async checkForUpdates(): Promise<DesktopUpdateSnapshot> {
    if (!this.isPackaged || !this.updateOrigin) return this.getSnapshot();
    if (this.checkPromise) return this.checkPromise;

    this.checkPromise = (async () => {
      this.setState(DesktopUpdateStates.Checking);
      try {
        await autoUpdater.checkForUpdates();
        return this.getSnapshot();
      } catch (error) {
        this.setError(error);
        return this.getSnapshot();
      } finally {
        this.checkPromise = undefined;
      }
    })();
    return this.checkPromise;
  }

  async downloadUpdate(): Promise<DesktopUpdateSnapshot> {
    if (!this.isPackaged || this.snapshot.state !== DesktopUpdateStates.Available) return this.getSnapshot();
    if (this.downloadPromise) return this.downloadPromise;

    this.downloadPromise = (async () => {
      try {
        this.setState(DesktopUpdateStates.Downloading, { percent: 0 });
        await autoUpdater.downloadUpdate();
        return this.getSnapshot();
      } catch (error) {
        this.setError(error);
        return this.getSnapshot();
      } finally {
        this.downloadPromise = undefined;
      }
    })();
    return this.downloadPromise;
  }

  installUpdate(): DesktopUpdateSnapshot {
    if (!this.isPackaged || this.snapshot.state !== DesktopUpdateStates.Downloaded) return this.getSnapshot();
    autoUpdater.quitAndInstall(false, true);
    return this.getSnapshot();
  }

  private bindUpdater(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableDifferentialDownload = false;
    autoUpdater.logger = {
      info: (message: string) => this.publishLog(`updater info: ${message}`),
      warn: (message: string) => this.publishLog(`updater warning: ${message}`),
      error: (message: string) => this.publishLog(`updater error: ${message}`),
      debug: (message: string) => this.publishLog(`updater debug: ${message}`),
    };
    autoUpdater.on("checking-for-update", () => this.setState(DesktopUpdateStates.Checking));
    autoUpdater.on("update-available", (info) => this.handleUpdateAvailable(info));
    autoUpdater.on("update-not-available", () => this.setState(DesktopUpdateStates.NotAvailable));
    autoUpdater.on("download-progress", (progress) => this.handleDownloadProgress(progress));
    autoUpdater.on("update-downloaded", () =>
      this.setState(DesktopUpdateStates.Downloaded, {
        percent: 100,
        errorCode: undefined,
        errorMessage: undefined,
      }),
    );
    autoUpdater.on("error", (error) => this.setError(error));
  }

  private configureUpdaterFeed(origin: AgentRuntimeUpdateOrigin): void {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: origin.desktopFeedUrl,
      channel: "latest",
    });
    this.publishLog(`updater feed configured: ${origin.desktopFeedUrl}`);
  }

  private handleUpdateAvailable(info: UpdateInfo): void {
    this.setState(DesktopUpdateStates.Available, {
      availableVersion: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseDate: info.releaseDate,
    });
  }

  private handleDownloadProgress(progress: ProgressInfo): void {
    this.setState(DesktopUpdateStates.Downloading, {
      percent: clampPercent(progress.percent),
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  }

  private setState(state: DesktopUpdateState, patch: Partial<DesktopUpdateSnapshot> = {}): void {
    const reset: Partial<DesktopUpdateSnapshot> =
      state === DesktopUpdateStates.Checking
        ? resetForCheck()
        : state === DesktopUpdateStates.Available
          ? resetForAvailable()
          : state === DesktopUpdateStates.NotAvailable
            ? resetForCheck()
            : state === DesktopUpdateStates.Idle || state === DesktopUpdateStates.Unsupported
              ? resetForCheck()
              : state === DesktopUpdateStates.Downloading || state === DesktopUpdateStates.Downloaded
                ? { errorCode: undefined, errorMessage: undefined }
                : {};
    this.snapshot = {
      ...this.snapshot,
      ...reset,
      ...patch,
      state,
      currentVersion: this.currentVersion,
      ...(state === DesktopUpdateStates.Error ? { percent: undefined } : {}),
    };
    this.onStateChanged?.(this.getSnapshot());
  }

  private setError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.publishLog(`updater failure: ${message}`);
    const errorCode = classifyUpdaterFailure(message);
    this.setState(DesktopUpdateStates.Error, { errorCode, errorMessage: errorCode });
  }
}

function resetForCheck(): Partial<DesktopUpdateSnapshot> {
  return {
    availableVersion: undefined,
    releaseName: undefined,
    releaseDate: undefined,
    percent: undefined,
    transferredBytes: undefined,
    totalBytes: undefined,
    bytesPerSecond: undefined,
    errorCode: undefined,
    errorMessage: undefined,
  };
}

function resetForAvailable(): Partial<DesktopUpdateSnapshot> {
  return {
    percent: undefined,
    transferredBytes: undefined,
    totalBytes: undefined,
    bytesPerSecond: undefined,
    errorCode: undefined,
    errorMessage: undefined,
  };
}

function classifyUpdaterFailure(message: string): DesktopUpdateSnapshot["errorCode"] {
  const normalized = message.toLowerCase();
  if (normalized.includes("status code 404") || normalized.includes("http 404")) {
    return AgentRuntimeUpdateFailureCodes.NotPublished;
  }
  if (normalized.includes("redirect")) return AgentRuntimeUpdateFailureCodes.RedirectRejected;
  if (normalized.includes("latest.yml") || normalized.includes("invalid update")) {
    return AgentRuntimeUpdateFailureCodes.InvalidManifest;
  }
  if (normalized.includes("timed out") || normalized.includes("network") || normalized.includes("econn")) {
    return AgentRuntimeUpdateFailureCodes.RequestFailed;
  }
  return "update_failed";
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
