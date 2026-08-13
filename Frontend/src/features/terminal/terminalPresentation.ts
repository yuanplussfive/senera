import type { ITheme } from "@xterm/xterm";
import type {
  ExecutionResourceSnapshotData,
  ExecutionResourceState,
  ExecutionResourceTerminalData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";

export const TerminalXtermTheme = {
  background: "#101310",
  foreground: "#e7ebe6",
  cursor: "#72a58d",
  cursorAccent: "#101310",
  selectionBackground: "#53645b99",
  black: "#101310",
  brightBlack: "#707a72",
  red: "#d8706a",
  brightRed: "#ee8f87",
  green: "#87a978",
  brightGreen: "#a5c995",
  yellow: "#c9a45c",
  brightYellow: "#e0bd73",
  blue: "#7895ad",
  brightBlue: "#91aec5",
  magenta: "#aa8daa",
  brightMagenta: "#c4a5c4",
  cyan: "#6faaa3",
  brightCyan: "#88c4bc",
  white: "#d5d9d4",
  brightWhite: "#f5f7f4",
} as const satisfies ITheme;

export function readTerminalXtermTheme(container: HTMLElement): ITheme {
  const probe = document.createElement("span");
  const selectionProbe = document.createElement("span");
  probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "background:var(--terminal-canvas)",
    "color:var(--terminal-foreground)",
    "border-color:var(--terminal-accent)",
    "outline-color:var(--terminal-muted)",
  ].join(";");
  selectionProbe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "background:color-mix(in srgb,var(--terminal-accent) 24%,transparent)",
  ].join(";");
  container.append(probe, selectionProbe);
  const style = getComputedStyle(probe);
  const selectionStyle = getComputedStyle(selectionProbe);
  const theme = {
    ...TerminalXtermTheme,
    background: style.backgroundColor || TerminalXtermTheme.background,
    foreground: style.color || TerminalXtermTheme.foreground,
    cursor: style.borderColor || TerminalXtermTheme.cursor,
    cursorAccent: style.backgroundColor || TerminalXtermTheme.cursorAccent,
    selectionBackground: selectionStyle.backgroundColor || TerminalXtermTheme.selectionBackground,
    brightBlack: style.outlineColor || TerminalXtermTheme.brightBlack,
  } satisfies ITheme;
  probe.remove();
  selectionProbe.remove();
  return theme;
}

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
  starting: "bg-umber-500 animate-pulse",
  running: "bg-[var(--terminal-accent)]",
  stopping: "bg-amber-400 animate-pulse",
  completed: "bg-moss-400",
  failed: "bg-brick-500",
  cancelled: "bg-[var(--terminal-subtle)]",
} as const satisfies Record<ExecutionResourceState, string>;

export function terminalStatusIndicatorClass(state: ExecutionResourceState): string {
  return StatusIndicatorClassNames[state];
}
