import type {
  SeneraProcessLocalFallback,
  SeneraProcessNetworkMode,
  SeneraProcessWorkspaceMountMode,
} from "../Execution/SeneraExecutionProfile.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type {
  ToolExecutionManifest,
} from "../Types/PluginManifestTypes.js";

export type AgentToolExecutionMode = "local" | "sandbox" | "sandbox-preferred";

export interface AgentToolExecutionPolicy {
  mode: AgentToolExecutionMode;
  network: SeneraProcessNetworkMode;
  workspaceMount: SeneraProcessWorkspaceMountMode;
  localFallback: SeneraProcessLocalFallback;
  reasons: readonly string[];
}

type PolicyDraft = Omit<AgentToolExecutionPolicy, "reasons"> & {
  reasons: string[];
};

const BoundaryByToolExecutionManifest = {
  Local: "local",
  Sandbox: "sandbox",
  SandboxPreferred: "sandbox-preferred",
} satisfies Record<ToolExecutionManifest["Boundary"], AgentToolExecutionMode>;

const LocalFallbackByManifest = {
  Allow: "allow",
  Deny: "deny",
} satisfies Record<ToolExecutionManifest["LocalFallback"], SeneraProcessLocalFallback>;

const NetworkByManifest = {
  Allow: "default",
  Deny: "disabled",
} satisfies Record<"Allow" | "Deny", SeneraProcessNetworkMode>;

const WorkspaceMountByManifest = {
  ReadOnly: "readonly",
  ReadWrite: "writable",
} satisfies Record<ToolExecutionManifest["Workspace"], SeneraProcessWorkspaceMountMode>;

export function resolveAgentToolExecutionPolicy(tool: RegisteredTool): AgentToolExecutionPolicy {
  const mode = resolveExecutionMode(tool);
  const draft: PolicyDraft = {
    mode,
    network: resolveNetworkMode(tool),
    workspaceMount: resolveWorkspaceMount(tool),
    localFallback: LocalFallbackByManifest[tool.execution.LocalFallback],
    reasons: [],
  };

  return {
    ...draft,
    reasons: [
      ...explainMode(tool, mode),
      `network=${draft.network}`,
      `workspaceMount=${draft.workspaceMount}`,
      `localFallback=${draft.localFallback}`,
    ],
  };
}

function resolveExecutionMode(tool: RegisteredTool): AgentToolExecutionMode {
  if (!tool.execution) {
    throw new Error(`工具缺少 Execution 配置：${tool.name}`);
  }

  return BoundaryByToolExecutionManifest[tool.execution.Boundary];
}

function resolveNetworkMode(tool: RegisteredTool): SeneraProcessNetworkMode {
  return NetworkByManifest[tool.execution.Network];
}

function resolveWorkspaceMount(tool: RegisteredTool): SeneraProcessWorkspaceMountMode {
  return WorkspaceMountByManifest[tool.execution.Workspace];
}

function explainMode(tool: RegisteredTool, mode: AgentToolExecutionMode): string[] {
  return [
    `mode=${mode}`,
    `tool.Execution.Boundary=${tool.execution.Boundary}`,
    `tool.Execution.Network=${tool.execution.Network}`,
    `tool.Execution.Workspace=${tool.execution.Workspace}`,
    `tool.Execution.LocalFallback=${tool.execution.LocalFallback}`,
  ];
}
