import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SeneraExecutionErrorCodes } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import {
  resolvePreparedSeneraTerminalSidecarGuestRuntime,
  resolveSeneraTerminalSidecarGuestRuntimeRoot,
} from "../../../Source/AgentSystem/Execution/SeneraTerminalSidecarGuestRuntime.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("Terminal Sidecar guest runtime", () => {
  it("resolves a prepared target-specific runtime without consulting host node_modules", () => {
    const baseDir = createRuntimeBase();
    const runtimeRoot = resolveSeneraTerminalSidecarGuestRuntimeRoot(baseDir, "x64");
    const packageRoot = path.join(runtimeRoot, "node_modules", "@senera", "terminal-sidecar");
    const entrypoint = path.join(packageRoot, "bin", "senera-terminal-sidecar.js");
    mkdirSync(path.dirname(entrypoint), { recursive: true });
    writeFileSync(entrypoint, "", "utf8");

    expect(resolvePreparedSeneraTerminalSidecarGuestRuntime(baseDir, "x64")).toEqual({
      sourceRoot: runtimeRoot,
      packageRoot,
      entrypoint,
      guestRoot: "/opt/senera-terminal",
      guestEntrypoint: "/opt/senera-terminal/node_modules/@senera/terminal-sidecar/bin/senera-terminal-sidecar.js",
      guestNodeCommand: "/usr/local/bin/node",
    });
  });

  it("reports an actionable sandbox error when preparation has not run", () => {
    const baseDir = createRuntimeBase();

    expect(() => resolvePreparedSeneraTerminalSidecarGuestRuntime(baseDir, "x64")).toThrowError(
      expect.objectContaining({
        code: SeneraExecutionErrorCodes.SandboxUnavailable,
        details: expect.objectContaining({ reason: "terminal_runtime_unprepared" }),
      }),
    );
  });

  it("rejects architectures without a published Linux PTY runtime", () => {
    const baseDir = createRuntimeBase();

    expect(() => resolveSeneraTerminalSidecarGuestRuntimeRoot(baseDir, "ia32")).toThrowError(
      expect.objectContaining({
        code: SeneraExecutionErrorCodes.SandboxUnavailable,
        details: expect.objectContaining({ reason: "terminal_architecture_unsupported" }),
      }),
    );
  });
});

function createRuntimeBase(): string {
  const directory = createTemporaryDirectory("senera-terminal-guest-runtime");
  temporaryDirectories.push(directory);
  return directory;
}
