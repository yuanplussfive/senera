import type { ITheme } from "@xterm/xterm";
import type {
  ExecutionResourceSnapshotData,
  ExecutionResourceState,
  ExecutionResourceTerminalData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";

export const TerminalXtermTheme = {
  background: "#0c0c0c",
  foreground: "#cccccc",
  cursor: "#f2f2f2",
  cursorAccent: "#0c0c0c",
  selectionBackground: "#264f78",
  black: "#0c0c0c",
  brightBlack: "#767676",
  red: "#c50f1f",
  brightRed: "#e74856",
  green: "#13a10e",
  brightGreen: "#16c60c",
  yellow: "#c19c00",
  brightYellow: "#f9f1a5",
  blue: "#0037da",
  brightBlue: "#3b78ff",
  magenta: "#881798",
  brightMagenta: "#b4009e",
  cyan: "#3a96dd",
  brightCyan: "#61d6d6",
  white: "#cccccc",
  brightWhite: "#f2f2f2",
} as const satisfies ITheme;

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

const StatusIndicatorClassNames = {
  starting: "bg-[#d19a66] animate-pulse",
  running: "bg-[var(--terminal-accent)]",
  stopping: "bg-[#d7ba7d] animate-pulse",
  completed: "bg-[#89d185]",
  failed: "bg-[#f14c4c]",
  cancelled: "bg-[var(--terminal-subtle)]",
} as const satisfies Record<ExecutionResourceState, string>;

export function terminalStatusIndicatorClass(state: ExecutionResourceState): string {
  return StatusIndicatorClassNames[state];
}
