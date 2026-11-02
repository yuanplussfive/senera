import { WebglAddon } from "@xterm/addon-webgl";
import type { IDisposable, Terminal } from "@xterm/xterm";

export type TerminalRendererState =
  { kind: "webgl" } | { kind: "dom"; reason: "inactive" | "unavailable" | "context-lost"; detail?: string };

/** Inactive tabs retain terminal state while releasing their GPU context. */
export class TerminalRenderer {
  private addon?: WebglAddon;
  private contextLoss?: IDisposable;
  private active = false;

  constructor(
    private readonly terminal: Terminal,
    private readonly onChange: (state: TerminalRendererState) => void,
  ) {}

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.release();
    if (!active) {
      this.onChange({ kind: "dom", reason: "inactive" });
      return;
    }
    try {
      const addon = new WebglAddon();
      this.addon = addon;
      this.terminal.loadAddon(addon);
      this.contextLoss = addon.onContextLoss(() => {
        this.release();
        this.terminal.refresh(0, this.terminal.rows - 1);
        this.onChange({ kind: "dom", reason: "context-lost" });
      });
      this.onChange({ kind: "webgl" });
    } catch (error) {
      this.release();
      this.onChange({
        kind: "dom",
        reason: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  dispose(): void {
    this.active = false;
    this.release();
  }

  private release(): void {
    this.contextLoss?.dispose();
    this.contextLoss = undefined;
    this.addon?.dispose();
    this.addon = undefined;
  }
}
