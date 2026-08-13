import type { CSSProperties } from "react";

export const TerminalSurfaceStyle = {
  "--terminal-canvas": "var(--theme-code-editor-bg)",
  "--terminal-chrome": "var(--surface-subtle)",
  "--terminal-elevated": "var(--surface-raised)",
  "--terminal-border": "var(--line-default)",
  "--terminal-separator": "var(--line-subtle)",
  "--terminal-foreground": "var(--theme-code-editor-fg)",
  "--terminal-muted": "var(--content-secondary)",
  "--terminal-subtle": "var(--content-muted)",
  "--terminal-accent": "var(--accent-solid)",
  "--terminal-hover": "var(--surface-hover)",
} as CSSProperties;
