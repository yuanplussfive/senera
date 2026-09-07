import type { SandboxPreparationProgressData, SandboxStatusSnapshotData } from "../../api/eventTypes.js";
import { frontendMessage } from "../../i18n/frontendMessageCatalog.js";

export function sandboxStatusDetail(status?: SandboxStatusSnapshotData | null): string {
  return status?.progress
    ? describeSandboxPreparation(status.progress)
    : (status?.message ?? frontendMessage("sandbox.status.unsynced"));
}

export function sandboxStatusAvailabilitySuffix(status?: SandboxStatusSnapshotData | null): string {
  if (status?.effectiveMode === "host") return frontendMessage("sandbox.status.disabledSuffix");
  if (status?.effectiveMode !== "sandbox") return frontendMessage("sandbox.status.unavailableSuffix");
  return frontendMessage("sandbox.status.sandboxSuffix", { provider: sandboxProviderLabel(status.provider) });
}

export function executionModeLabel(status?: SandboxStatusSnapshotData | null): string {
  if (!status) return frontendMessage("execution.mode.unsynced");
  if (status.state === "preparing") return frontendMessage("execution.mode.preparing");
  if (status.effectiveMode === "sandbox") {
    return frontendMessage("execution.mode.sandbox", { provider: sandboxProviderLabel(status.provider) });
  }
  if (status.effectiveMode === "host") {
    return frontendMessage("execution.mode.host", { shell: shellDialectLabel(status.shellDialect) });
  }
  return frontendMessage("execution.mode.unavailable");
}

export function sandboxProviderLabel(provider: string | undefined): string {
  switch (provider) {
    case "gvisor":
      return frontendMessage("sandbox.provider.gvisor");
    case "docker-engine":
      return frontendMessage("sandbox.provider.dockerEngine");
    default:
      return frontendMessage("sandbox.provider.unknown");
  }
}

function shellDialectLabel(dialect: SandboxStatusSnapshotData["shellDialect"]): string {
  return dialect === "powershell"
    ? frontendMessage("execution.shell.powershell")
    : frontendMessage("execution.shell.posix");
}

export function sandboxPreparationRatio(progress?: SandboxPreparationProgressData): number | undefined {
  const values =
    progress?.downloadedBytes !== undefined && progress.totalBytes !== undefined
      ? [progress.downloadedBytes, progress.totalBytes]
      : progress?.completed !== undefined && progress.total !== undefined
        ? [progress.completed, progress.total]
        : undefined;
  if (!values || values[1] <= 0) return undefined;
  return Math.min(1, Math.max(0, values[0] / values[1]));
}

function describeSandboxPreparation(progress: SandboxPreparationProgressData): string {
  const progressCount = formatProgressCount(progress);
  switch (progress.stage) {
    case "detecting_engine":
      return frontendMessage("sandbox.progress.detectingEngine", { item: progress.item ?? "" });
    case "connecting_worker":
      return frontendMessage("sandbox.progress.connectingWorker");
    case "pulling_image":
      return frontendMessage("sandbox.progress.pullingImage", {
        item: progress.item ?? "",
        progress: formatImageProgress(progress) ?? progressCount,
      });
    case "verifying_image":
      return frontendMessage("sandbox.progress.verifyingImage", { item: progress.item ?? "" });
    case "probing_toolchain":
      return frontendMessage("sandbox.progress.probingToolchain", {
        item: progress.item ?? "",
        progress: progressCount,
      });
  }
}

function formatProgressCount(progress: SandboxPreparationProgressData): string {
  return progress.completed === undefined || progress.total === undefined
    ? ""
    : `${progress.completed}/${progress.total}`;
}

function formatImageProgress(progress: SandboxPreparationProgressData): string | undefined {
  if (progress.downloadedBytes === undefined || progress.totalBytes === undefined) return undefined;
  return `${formatByteSize(progress.downloadedBytes)} / ${formatByteSize(progress.totalBytes)}`;
}

function formatByteSize(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  const unitIndex = Math.min(Math.floor(Math.log(Math.max(safeBytes, 1)) / Math.log(1024)), 4);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = units[unitIndex] ?? "TiB";
  const value = safeBytes / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unitIndex === 0 ? 0 : 1 }).format(value)} ${unit}`;
}
