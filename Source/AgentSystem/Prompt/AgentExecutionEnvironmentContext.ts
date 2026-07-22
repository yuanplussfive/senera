import path from "node:path";
import { resolveSeneraShellPlatform } from "../Execution/SeneraShellPlatform.js";
import { SeneraMicrosandboxDefaults } from "../Execution/SeneraMicrosandboxDefaults.js";

export interface AgentExecutionEnvironmentContext {
  os: string;
  platform: NodeJS.Platform;
  shell: {
    family: "powershell" | "posix-sh";
    command: string;
    invocation: string;
  };
  executionTargets: {
    sandbox: AgentExecutionShellTarget;
    local: AgentExecutionShellTarget;
  };
  workspace: {
    root: string;
    pathStyle: "windows" | "posix";
    separator: "\\" | "/";
    preferredPathForm: "workspace-relative";
  };
  guidance: {
    shell: string[];
    paths: string[];
  };
}

interface AgentExecutionShellTarget {
  os: string;
  boundary: "sandbox" | "local";
  shellDialect: "posix-sh" | "powershell";
  shellCommand: string;
  image?: string;
}

export function buildAgentExecutionEnvironmentContext(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): AgentExecutionEnvironmentContext {
  const windows = platform === "win32";
  const shell = resolveSeneraShellPlatform(platform);
  return {
    os: osName(platform),
    platform,
    shell: windows
      ? {
          family: "powershell",
          command: shell.command,
          invocation: shell.invocation,
        }
      : {
          family: shell.family,
          command: shell.command,
          invocation: shell.invocation,
        },
    executionTargets: {
      sandbox: {
        os: "Linux",
        boundary: "sandbox",
        shellDialect: "posix-sh",
        shellCommand: SeneraMicrosandboxDefaults.guestShell.command,
        image: SeneraMicrosandboxDefaults.image,
      },
      local: {
        os: osName(platform),
        boundary: "local",
        shellDialect: shell.family,
        shellCommand: shell.command,
      },
    },
    workspace: {
      root: path.resolve(workspaceRoot),
      pathStyle: windows ? "windows" : "posix",
      separator: windows ? "\\" : "/",
      preferredPathForm: "workspace-relative",
    },
    guidance: {
      shell: windows
        ? [
            "Sandbox shell tools run in the Linux sandbox with the posix-sh dialect.",
            `Local shell tools run in ${shell.command} with the powershell dialect.`,
            "Set command.mode, command.dialect, and command.script explicitly; never send PowerShell syntax to a posix-sh target.",
            "Use PowerShell syntax only for Local execution, for example: $c=Get-Content -Path Source\\File.ts; $c[0..120].",
            "Use Get-ChildItem, Select-String, Get-Content, Get-Command, and rg when they fit the task.",
            "Do not use Bash-only commands such as which, test, grep pipelines, or POSIX path syntax unless you explicitly invoke a POSIX shell.",
          ]
        : [
            "Sandbox shell tools run in the Linux sandbox with the posix-sh dialect.",
            "Local shell tools run in POSIX sh on this platform.",
            "Set command.mode, command.dialect, and command.script explicitly.",
            "Use POSIX shell syntax for local inspection, for example: sed -n '1,120p' Source/File.ts.",
            "Use ls, find, grep, sed, awk, and rg when they fit the task.",
          ],
      paths: [
        "Prefer workspace-relative paths in tool arguments.",
        "Do not assume Windows paths work on POSIX or POSIX paths work on Windows unless the environment block says so.",
        "Keep cwd inside the workspace root.",
      ],
    },
  };
}

function osName(platform: NodeJS.Platform): string {
  const names: Partial<Record<NodeJS.Platform, string>> = {
    win32: "Windows",
    darwin: "macOS",
    linux: "Linux",
  };
  return names[platform] ?? platform;
}
