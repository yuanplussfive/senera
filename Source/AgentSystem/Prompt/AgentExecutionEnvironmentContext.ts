import path from "node:path";
import { resolveSeneraShellPlatform } from "../Execution/SeneraShellPlatform.js";
import { readAgentDockerEngineRuntimeContract } from "../Sandbox/DockerEngine/AgentDockerEngineRuntimeContract.js";
import {
  createSeneraExecutionRuntimeCapabilities,
  type SeneraExecutionRuntimeCapabilities,
} from "../Execution/SeneraExecutionRuntimeCapabilities.js";

export interface AgentExecutionEnvironmentContext {
  os: string;
  platform: NodeJS.Platform;
  shell: {
    family: "powershell" | "posix-sh";
    command: string;
    invocation: string;
  };
  executionTargets: {
    local: AgentExecutionShellTarget;
    sandbox: AgentExecutionShellTarget | null;
  };
  workspace: {
    root: string;
    logicalRoot: ".";
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
  workspaceRoot: string;
  workspacePathStyle: "windows" | "posix";
  workspaceSeparator: "\\" | "/";
  workspaceMount: "host" | "bind";
  image?: string;
}

export function buildAgentExecutionEnvironmentContext(
  workspaceRoot: string,
  capabilities: SeneraExecutionRuntimeCapabilities = createSeneraExecutionRuntimeCapabilities(),
  platform: NodeJS.Platform = process.platform,
): AgentExecutionEnvironmentContext {
  const windows = platform === "win32";
  const shell = resolveSeneraShellPlatform(platform);
  const sandbox = capabilities.sandbox
    ? readAgentDockerEngineRuntimeContract(capabilities.sandbox.provider)
    : undefined;
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
      local: {
        os: osName(platform),
        boundary: "local",
        shellDialect: shell.family,
        shellCommand: shell.command,
        workspaceRoot: path.resolve(workspaceRoot),
        workspacePathStyle: windows ? "windows" : "posix",
        workspaceSeparator: windows ? "\\" : "/",
        workspaceMount: "host",
      },
      sandbox: sandbox
        ? {
            os: "Linux",
            boundary: "sandbox",
            shellDialect: "posix-sh",
            shellCommand: sandbox.contract.guest.shell.command,
            workspaceRoot: sandbox.contract.guest.workspaceRoot,
            workspacePathStyle: "posix",
            workspaceSeparator: "/",
            workspaceMount: "bind",
            image: sandbox.image.runtimeImage,
          }
        : null,
    },
    workspace: {
      root: path.resolve(workspaceRoot),
      logicalRoot: ".",
      pathStyle: windows ? "windows" : "posix",
      separator: windows ? "\\" : "/",
      preferredPathForm: "workspace-relative",
    },
    guidance: {
      shell: shellGuidance(windows, shell.command, path.resolve(workspaceRoot), sandbox?.contract.guest.workspaceRoot),
      paths: [
        "Prefer workspace-relative paths in tool arguments.",
        "Do not assume Windows paths work on POSIX or POSIX paths work on Windows unless the environment block says so.",
        "Keep cwd inside the workspace root.",
      ],
    },
  };
}

function shellGuidance(
  windows: boolean,
  shellCommand: string,
  localWorkspaceRoot: string,
  sandboxWorkspaceRoot: string | undefined,
): string[] {
  if (windows) {
    return [
      ...(sandboxWorkspaceRoot
        ? [
            `Sandbox shell tools run in an isolated Linux container with the posix-sh dialect; its workspace root is ${sandboxWorkspaceRoot}.`,
            `The host workspace ${localWorkspaceRoot} is bind-mounted at ${sandboxWorkspaceRoot}; use workspace-relative paths instead of host Windows paths in Sandbox commands.`,
            "Set command.mode, command.dialect, and command.script explicitly; never send PowerShell syntax to a posix-sh target.",
          ]
        : []),
      `Local shell tools run on the Windows host through governed process execution using ${shellCommand}; its workspace root is ${localWorkspaceRoot}.`,
      "Use PowerShell syntax for Local execution, for example: $c=Get-Content -Path Source\\File.ts; $c[0..120].",
      "Use Get-ChildItem, Select-String, Get-Content, Get-Command, and rg when they fit the task.",
      "Do not use Bash-only commands such as which, test, grep pipelines, or POSIX path syntax for Local execution.",
    ];
  }
  return [
    ...(sandboxWorkspaceRoot
      ? [
          `Sandbox shell tools run in an isolated Linux container with the posix-sh dialect; its workspace root is ${sandboxWorkspaceRoot}.`,
          `The host workspace ${localWorkspaceRoot} is bind-mounted at ${sandboxWorkspaceRoot}; use workspace-relative paths instead of host paths in Sandbox commands.`,
        ]
      : []),
    `Local shell tools run on the host through governed process execution using POSIX sh; its workspace root is ${localWorkspaceRoot}.`,
    "Set command.mode, command.dialect, and command.script explicitly.",
    "Use POSIX shell syntax for local inspection, for example: sed -n '1,120p' Source/File.ts.",
    "Use ls, find, grep, sed, awk, and rg when they fit the task.",
  ];
}

function osName(platform: NodeJS.Platform): string {
  const names: Partial<Record<NodeJS.Platform, string>> = {
    win32: "Windows",
    darwin: "macOS",
    linux: "Linux",
  };
  return names[platform] ?? platform;
}
