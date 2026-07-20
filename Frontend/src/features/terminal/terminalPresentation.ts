import type { CSSProperties } from "react";
import type { ITheme } from "@xterm/xterm";
import type {
  ExecutionResourceSnapshotData,
  ExecutionResourceState,
  ExecutionResourceTerminalData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export const TerminalPalette = {
  canvas: "#101310",
  chrome: "#171b18",
  elevated: "#1d221e",
  border: "#343a36",
  separator: "#2b302c",
  foreground: "#e7ebe6",
  muted: "#8d978f",
  subtle: "#68716a",
  accent: "#72a58d",
  selection: "#53645b99",
} as const;

export const TerminalSurfaceStyle = {
  "--terminal-canvas": TerminalPalette.canvas,
  "--terminal-chrome": TerminalPalette.chrome,
  "--terminal-elevated": TerminalPalette.elevated,
  "--terminal-border": TerminalPalette.border,
  "--terminal-separator": TerminalPalette.separator,
  "--terminal-foreground": TerminalPalette.foreground,
  "--terminal-muted": TerminalPalette.muted,
  "--terminal-subtle": TerminalPalette.subtle,
  "--terminal-accent": TerminalPalette.accent,
} as CSSProperties;

export const TerminalXtermTheme = {
  background: TerminalPalette.canvas,
  foreground: TerminalPalette.foreground,
  cursor: TerminalPalette.accent,
  cursorAccent: TerminalPalette.canvas,
  selectionBackground: TerminalPalette.selection,
  black: TerminalPalette.canvas,
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

export type TerminalCapability = ExecutionResourceTerminalData["capabilities"][number];

export function isTerminalState(state: ExecutionResourceState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function supportsTerminalCapability(
  resource: ExecutionResourceSnapshotData,
  capability: TerminalCapability,
): boolean {
  return resource.terminal?.capabilities.includes(capability) ?? false;
}

export function terminalTabLabel(resource: ExecutionResourceSnapshotData): string {
  const command = resource.command.trim();
  const executable = command.split(/[\\/]/u).at(-1) ?? command;
  return executable || resource.resourceId;
}

export function terminalStatusLabel(state: ExecutionResourceState): string {
  return frontendMessage(`terminal.status.${state}`);
}

const StatusIndicatorClassNames = {
  starting: "bg-umber-400 motion-safe:animate-pulse",
  running: "bg-[var(--terminal-accent)]",
  completed: "bg-moss-400",
  failed: "bg-brick-400",
  cancelled: "bg-[var(--terminal-subtle)]",
} as const satisfies Record<ExecutionResourceState, string>;

export function terminalStatusIndicatorClass(state: ExecutionResourceState): string {
  return StatusIndicatorClassNames[state];
}
