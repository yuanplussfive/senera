export interface AgentMcpNodeRuntime {
  readonly executable: string;
  readonly isElectron: boolean;
}

export interface AgentMcpNodeRuntimeLaunchInput {
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

export interface AgentMcpNodeRuntimeLaunch {
  readonly command: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
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

function cloneEnvironment(environment: Record<string, string> | undefined): Record<string, string> | undefined {
  return environment ? { ...environment } : undefined;
}
