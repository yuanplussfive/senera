import type { SandboxPreparationProgressData, SandboxStatusSnapshotData } from "../../api/eventTypes.js";
import { frontendMessage } from "../../i18n/frontendMessageCatalog.js";

export function sandboxStatusDetail(status?: SandboxStatusSnapshotData | null): string {
  return status?.progress
    ? describeSandboxPreparation(status.progress)
    : (status?.message ?? frontendMessage("sandbox.status.unsynced"));
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
    case "checking_host_runtime":
      return frontendMessage("sandbox.progress.checkingHostRuntime");
    case "loading_runtime":
      return frontendMessage("sandbox.progress.loadingRuntime");
    case "resolving_archive":
      return frontendMessage("sandbox.progress.resolvingArchive");
    case "downloading_archive":
      return frontendMessage("sandbox.progress.downloadingArchive", {
        progress: formatImageProgress(progress) ?? progressCount,
      });
    case "verifying_archive":
      return frontendMessage("sandbox.progress.verifyingArchive");
    case "importing_image":
      return frontendMessage("sandbox.progress.importingImage");
    case "warming_image":
      return frontendMessage("sandbox.progress.warmingImage", {
        item: progress.item ?? "",
        progress: formatImageProgress(progress) ?? progressCount,
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
