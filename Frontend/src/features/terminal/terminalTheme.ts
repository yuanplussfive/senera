import type { CSSProperties } from "react";
import type { ITerminalOptions, ITheme } from "@xterm/xterm";
import type { AppearanceSnapshot } from "../../shared/theme/themeModel";

export type TerminalTheme = ITheme & Required<Pick<ITheme, "background" | "foreground" | "selectionBackground">>;

const TerminalAnsiColors = {
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
} as const;

/** ANSI colors describe process output; the terminal surface follows the application palette. */
export function createTerminalXtermTheme(appearance: AppearanceSnapshot): TerminalTheme {
  const variables = appearance.tokens.cssVariables;
  const color = (token: string): string => `rgb(${variables[token].trim().split(/\s+/).join(",")})`;
  const background = color("--color-paper-50");
  const foreground = color("--color-ink-900");
  return {
    ...TerminalAnsiColors,
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: color("--color-accent-100"),
    selectionForeground: color("--color-ink-950"),
  };
}

export const TerminalTextOptions = {
  fontFamily:
    '"Cascadia Mono", "JetBrains Mono", "Segoe UI Emoji", "Noto Color Emoji", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12.5,
  lineHeight: 1.34,
  scrollback: 10_000,
  minimumContrastRatio: 4.5,
} as const satisfies ITerminalOptions;

export const TerminalSurfaceStyle = {
  "--terminal-canvas": "var(--surface-panel)",
  "--terminal-chrome": "var(--surface-panel)",
  "--terminal-elevated": "var(--surface-panel)",
  "--terminal-border": "var(--line-default)",
  "--terminal-separator": "var(--line-subtle)",
  "--terminal-foreground": "var(--content-primary)",
  "--terminal-muted": "var(--content-secondary)",
  "--terminal-subtle": "var(--content-muted)",
  "--terminal-accent": "var(--accent-content)",
  "--terminal-hover": "var(--surface-hover)",
  "--terminal-success": "rgb(var(--color-moss-600))",
  "--terminal-warning": "rgb(var(--color-umber-600))",
  "--terminal-error": "rgb(var(--color-brick-600))",
} as CSSProperties;

/** Portals inherit application colors and share terminal semantic aliases. */
export const TerminalOverlayStyle = {
  ...TerminalSurfaceStyle,
  "--overlay-surface-radius": "8px",
  "--menu-item-radius": "4px",
} as CSSProperties;
