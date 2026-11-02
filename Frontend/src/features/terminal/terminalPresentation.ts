import type {
  ExecutionResourceSnapshotData,
  ExecutionResourceState,
  ExecutionResourceTerminalData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import type { AppIconName } from "../../shared/ui/AppIcon";

export type TerminalCapability = ExecutionResourceTerminalData["capabilities"][number];

export function isTerminalState(state: ExecutionResourceState): boolean {
  return state === "stopping" || state === "completed" || state === "failed" || state === "cancelled";
}

export function supportsTerminalCapability(
  resource: ExecutionResourceSnapshotData,
  capability: TerminalCapability,
): boolean {
  return resource.terminal?.capabilities.includes(capability) ?? false;
}

export function terminalTabLabel(resource: ExecutionResourceSnapshotData): string {
  const explicitTitle = resource.presentation?.title?.trim();
  if (explicitTitle) return explicitTitle;
  if (resource.presentation?.purpose === "command-task") return frontendFeatureMessage("terminal.kind.commandTask");
  if (resource.terminal?.shellDialect === "powershell") return frontendFeatureMessage("terminal.kind.powershell");
  if (resource.terminal?.shellDialect === "posix-sh") return frontendFeatureMessage("terminal.kind.shell");
  return frontendMessage("terminal.kind.process");
}

export function terminalSelectionOptions(
  resources: readonly ExecutionResourceSnapshotData[],
): Array<{ value: string; label: string }> {
  const totals = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const resource of resources) {
    const title = terminalTabLabel(resource);
    totals.set(title, (totals.get(title) ?? 0) + 1);
  }
  return resources.map((resource) => {
    const title = terminalTabLabel(resource);
    const number = (occurrences.get(title) ?? 0) + 1;
    occurrences.set(title, number);
    return {
      value: resource.resourceId,
      label: totals.get(title) === 1 ? title : frontendFeatureMessage("terminal.resource.numbered", { title, number }),
    };
  });
}

export function terminalPurposeLabel(resource: ExecutionResourceSnapshotData): string {
  if (resource.presentation?.purpose === "command-task") return frontendFeatureMessage("terminal.kind.commandTask");
  if (resource.presentation?.purpose === "interactive-shell")
    return frontendFeatureMessage("terminal.kind.interactiveShell");
  return resource.kind === "terminal"
    ? frontendFeatureMessage("terminal.kind.interactiveShell")
    : frontendMessage("terminal.kind.process");
}

export function terminalStatusLabel(state: ExecutionResourceState): string {
  return frontendMessage(`terminal.status.${state}`);
}

const ConnectionPresentations = {
  starting: { icon: "clock", className: "text-[var(--terminal-warning)]" },
  running: { icon: "link", className: "text-[var(--terminal-success)]" },
  stopping: { icon: "clock", className: "text-[var(--terminal-warning)]" },
  completed: { icon: "terminal", className: "text-[var(--terminal-subtle)]" },
  failed: { icon: "warning", className: "text-[var(--terminal-error)]" },
  cancelled: { icon: "terminal", className: "text-[var(--terminal-subtle)]" },
} as const satisfies Record<ExecutionResourceState, { icon: AppIconName; className: string }>;

export function terminalConnectionPresentation(state: ExecutionResourceState) {
  return ConnectionPresentations[state];
}
