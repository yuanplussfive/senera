import type { SeneraProcessBackendPreference } from "../Execution/SeneraExecutionProfile.js";
import type { AgentMcpStdioRuntimeEndpoint } from "../McpPackages/AgentMcpPackageTypes.js";

export interface AgentMcpNodeRuntime {
  readonly executable: string;
  readonly isElectron: boolean;
}

export interface AgentMcpNodeRuntimeLaunchInput {
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentMcpNodeRuntimeLaunch {
  readonly command: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
}

/**
 * Resolve a declared Node MCP runtime at the process boundary. Local desktop
 * launches use Electron's embedded Node; sandbox launches keep the portable
 * command so the container can resolve its own Node runtime.
 */
export function createAgentMcpStdioRuntimeLaunch(
  server: AgentMcpStdioRuntimeEndpoint,
  backend: SeneraProcessBackendPreference | undefined,
): AgentMcpNodeRuntimeLaunch {
  if (server.runtime === "node" && backend === "local") {
    return createAgentMcpNodeRuntimeLaunch({ args: server.args, env: server.env });
  }

  return {
    command: server.command,
    args: [...server.args],
    env: cloneEnvironment(server.env),
  };
}

export function createAgentMcpNodeRuntimeLaunch(
  input: AgentMcpNodeRuntimeLaunchInput,
  runtime: AgentMcpNodeRuntime = currentAgentMcpNodeRuntime(),
): AgentMcpNodeRuntimeLaunch {
  return {
    command: runtime.executable,
    args: [...input.args],
    env: runtime.isElectron ? { ...(input.env ?? {}), ELECTRON_RUN_AS_NODE: "1" } : cloneEnvironment(input.env),
  };
}

function currentAgentMcpNodeRuntime(): AgentMcpNodeRuntime {
  return {
    executable: process.execPath,
    isElectron: typeof process.versions.electron === "string",
  };
}

function cloneEnvironment(
  environment: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  return environment ? { ...environment } : undefined;
}
