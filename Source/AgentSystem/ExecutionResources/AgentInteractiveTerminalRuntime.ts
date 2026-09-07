import { resolveSeneraShellPlatform } from "../Execution/SeneraShellPlatform.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraTerminalDimensions } from "../Execution/SeneraTerminalTypes.js";
import type { AgentExecutionResourceBroker } from "./AgentExecutionResourceBroker.js";
import { AgentExecutionResourcePurposes, type AgentExecutionResourceSnapshot } from "./AgentExecutionResourceTypes.js";

export interface AgentInteractiveTerminalExecutionLease {
  readonly executionEnv: SeneraExecutionEnv;
  release(): void;
}

export interface AgentInteractiveTerminalRuntimeOptions {
  readonly workspaceRoot: string;
  readonly broker: AgentExecutionResourceBroker;
  readonly acquireExecutionEnv: () => AgentInteractiveTerminalExecutionLease;
}

export interface AgentInteractiveTerminalStartRequest {
  readonly sessionId: string;
  readonly cwd?: string;
  readonly dimensions?: Partial<SeneraTerminalDimensions>;
}

export class AgentInteractiveTerminalRuntime {
  constructor(private readonly options: AgentInteractiveTerminalRuntimeOptions) {}

  async start(request: AgentInteractiveTerminalStartRequest): Promise<AgentExecutionResourceSnapshot> {
    const lease = this.options.acquireExecutionEnv();
    try {
      const capabilities = lease.executionEnv.capabilities;
      const backend = capabilities.effectiveBackend;
      if (!backend) throw new Error("Interactive terminal execution is unavailable in the active runtime.");
      const invocation = resolveInteractiveShellInvocation(capabilities.shellDialect);
      const profile: SeneraProcessExecutionProfile = {
        name: "interactive-terminal",
        kind: "shell",
        backend,
        ...(backend === "sandbox" ? { sandbox: { network: "default", workspaceMount: "writable" } } : {}),
      };
      return await this.options.broker.startTerminal({
        command: invocation.command,
        args: invocation.args,
        displayCommand: invocation.displayCommand,
        cwd: request.cwd ?? this.options.workspaceRoot,
        executionEnv: lease.executionEnv,
        profile,
        owner: { workspaceRoot: this.options.workspaceRoot, sessionId: request.sessionId },
        correlation: { sessionId: request.sessionId },
        dimensions: request.dimensions,
        presentation: { purpose: AgentExecutionResourcePurposes.InteractiveShell },
      });
    } finally {
      lease.release();
    }
  }
}

function resolveInteractiveShellInvocation(shellDialect: SeneraExecutionEnv["capabilities"]["shellDialect"]): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  if (shellDialect === "powershell") {
    const shell = resolveSeneraShellPlatform();
    return { command: shell.command, args: ["-NoLogo"], displayCommand: shell.command };
  }
  const command = process.platform === "win32" ? "sh" : process.env.SHELL?.trim() || "/bin/sh";
  return { command, args: ["-l"], displayCommand: command };
}
