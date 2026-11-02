import { spawnSync } from "node:child_process";

export interface SeneraShellInvocation {
  command: string;
  args: string[];
}

export interface SeneraShellPlatform {
  family: "powershell" | "posix-sh";
  command: string;
  invocation: string;
  version: "powershell-core" | "windows-powershell" | "posix";
}

let resolvedWindowsShellCommand: string | undefined;

export function resolveSeneraShellInvocation(command: string): SeneraShellInvocation {
  const shell = resolveSeneraShellPlatform();
  return shell.family === "powershell"
    ? {
        command: shell.command,
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", withPowerShellRuntimePreamble(command)],
      }
    : {
        command: shell.command,
        args: ["-lc", command],
      };
}

export function resolveSeneraShellPlatform(platform: NodeJS.Platform = process.platform): SeneraShellPlatform {
  if (platform === "win32") {
    const command = resolveWindowsPowerShellCommand(platform);
    return {
      family: "powershell",
      command,
      invocation: `${command} -NoLogo -NoProfile -NonInteractive -Command <command>`,
      version: command.toLowerCase().startsWith("pwsh") ? "powershell-core" : "windows-powershell",
    };
  }

  return {
    family: "posix-sh",
    command: "/bin/sh",
    invocation: "/bin/sh -lc <command>",
    version: "posix",
  };
}

function resolveWindowsPowerShellCommand(platform: NodeJS.Platform): string {
  if (platform !== process.platform) {
    return "pwsh.exe";
  }

  resolvedWindowsShellCommand ??= isCommandAvailable("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
  return resolvedWindowsShellCommand;
}

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(
    command,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  return !result.error;
}

function withPowerShellRuntimePreamble(command: string): string {
  return [
    "$__seneraUtf8 = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::OutputEncoding = $__seneraUtf8",
    "[Console]::InputEncoding = $__seneraUtf8",
    "$OutputEncoding = $__seneraUtf8",
    "if (Get-Variable PSStyle -ErrorAction SilentlyContinue) { $PSStyle.OutputRendering = 'PlainText' }",
    command,
  ].join("; ");
}
