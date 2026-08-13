import { describe, expect, test, vi } from "vitest";
import { applyTerminalSignal } from "../../../Packages/TerminalSidecar/terminal-control.js";

describe("terminal sidecar control", () => {
  test("uses ConPTY-compatible control operations on Windows", () => {
    const terminal = { write: vi.fn(), kill: vi.fn() };

    applyTerminalSignal(terminal, "interrupt", "win32");
    applyTerminalSignal(terminal, "terminate", "win32");
    applyTerminalSignal(terminal, "kill", "win32");

    expect(terminal.write).toHaveBeenCalledOnce();
    expect(terminal.write).toHaveBeenCalledWith("\u0003");
    expect(terminal.kill.mock.calls).toEqual([[], []]);
  });

  test("preserves POSIX signal semantics outside Windows", () => {
    const terminal = { write: vi.fn(), kill: vi.fn() };

    applyTerminalSignal(terminal, "interrupt", "linux");
    applyTerminalSignal(terminal, "terminate", "linux");
    applyTerminalSignal(terminal, "kill", "linux");

    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.kill.mock.calls).toEqual([["SIGINT"], ["SIGTERM"], ["SIGKILL"]]);
  });
});
