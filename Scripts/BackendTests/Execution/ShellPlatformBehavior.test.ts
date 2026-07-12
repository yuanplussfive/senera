import { describe, expect, test } from "vitest";
import { quoteShellArguments } from "../../../Source/AgentSystem/Execution/SeneraShellQuoting.js";
import {
  resolveSeneraShellInvocation,
  resolveSeneraShellPlatform,
} from "../../../Source/AgentSystem/Execution/SeneraShellPlatform.js";

describe("Shell platform behavior", () => {
  test("projects explicit POSIX platforms without inspecting host executables", () => {
    for (const platform of ["linux", "darwin", "freebsd"] as const) {
      expect(resolveSeneraShellPlatform(platform)).toEqual({
        family: "posix-sh",
        command: "/bin/sh",
        invocation: "/bin/sh -lc <command>",
        version: "posix",
      });
    }
  });

  test("projects Windows to a non-interactive PowerShell invocation", () => {
    const shell = resolveSeneraShellPlatform("win32");

    expect(shell.family).toBe("powershell");
    expect(shell.command).toMatch(/^(?:pwsh|powershell)\.exe$/u);
    expect(shell.invocation).toContain("-NoProfile -NonInteractive -Command");
    expect(shell.version).toMatch(/^powershell-(?:core|windows)$/u);
  });

  test("builds the current host invocation while preserving the original command", () => {
    const originalCommand = "printf senera-runtime";
    const invocation = resolveSeneraShellInvocation(originalCommand);

    if (process.platform === "win32") {
      expect(invocation.args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
      expect(invocation.args[4]).toContain("[Console]::OutputEncoding");
      expect(invocation.args[4]).toContain("$OutputEncoding");
      expect(invocation.args[4]).toContain(originalCommand);
      return;
    }

    expect(invocation).toEqual({ command: "/bin/sh", args: ["-lc", originalCommand] });
  });

  test("quotes only shell arguments that require protection", () => {
    expect(quoteShellArguments(["node", "", "two words", "can't", "$HOME", "plain-value"])).toBe(
      "node '' 'two words' 'can'\\''t' '$HOME' plain-value",
    );
  });
});
