import type { ToolExecutionManifest, ToolExecutionTarget } from "../Types/PluginManifestTypes.js";
import { ToolExecutionTargets } from "../Types/PluginToolManifestTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type {
  SeneraProcessBackendPreference,
  SeneraProcessNetworkMode,
  SeneraProcessWorkspaceMountMode,
} from "../Execution/SeneraExecutionProfile.js";

export const AgentToolExecutionTargetArgument = "executionTarget";

export interface AgentToolExecutionPlan {
  readonly target: ToolExecutionTarget;
  readonly backend: SeneraProcessBackendPreference;
  readonly network: SeneraProcessNetworkMode;
  readonly workspaceMount: SeneraProcessWorkspaceMountMode;
  readonly availableTargets: readonly ToolExecutionTarget[];
}

export interface AgentToolInvocation {
  readonly arguments: Record<string, unknown>;
  readonly executionPlan: AgentToolExecutionPlan;
}

export class AgentToolExecutionTargetError extends Error {
  constructor(
    readonly kind: "missing" | "invalid",
    readonly toolName: string,
    readonly availableTargets: readonly ToolExecutionTarget[],
    readonly value?: unknown,
  ) {
    super(executionTargetErrorMessage(kind, toolName, availableTargets, value));
    this.name = "AgentToolExecutionTargetError";
  }
}

export class AgentToolExecutionPlanError extends Error {
  constructor(
    readonly toolName: string,
    readonly plan: AgentToolExecutionPlan,
  ) {
    super(`Execution plan for tool ${toolName} does not match its declared execution contract.`);
    this.name = "AgentToolExecutionPlanError";
  }
}

const BackendByTarget = {
  [ToolExecutionTargets.Sandbox]: "sandbox",
  [ToolExecutionTargets.Local]: "local",
} as const satisfies Record<ToolExecutionTarget, SeneraProcessBackendPreference>;

const NetworkByManifest = {
  Allow: "default",
  Deny: "disabled",
} as const satisfies Record<ToolExecutionManifest["Network"], SeneraProcessNetworkMode>;

const WorkspaceMountByManifest = {
  ReadOnly: "readonly",
  ReadWrite: "writable",
} as const satisfies Record<ToolExecutionManifest["Workspace"], SeneraProcessWorkspaceMountMode>;

const InvocationSchemaProjectionCache = new WeakMap<object, WeakMap<ToolExecutionManifest, Record<string, unknown>>>();

export function resolveAgentToolInvocation(
  tool: RegisteredTool,
  suppliedArguments: Readonly<Record<string, unknown>>,
): AgentToolInvocation {
  const executionTarget = resolveExecutionTarget(tool, suppliedArguments);
  const arguments_ = { ...suppliedArguments };
  delete arguments_[AgentToolExecutionTargetArgument];
  return {
    arguments: arguments_,
    executionPlan: createAgentToolExecutionPlan(tool.execution, executionTarget),
  };
}

/**
 * Rebinds a previously selected plan to an invocation without allowing the
 * caller to change the public selection or pass it into the plugin contract.
 */
export function bindAgentToolInvocationToExecutionPlan(
  tool: RegisteredTool,
  suppliedArguments: Readonly<Record<string, unknown>>,
  executionPlan: AgentToolExecutionPlan,
): AgentToolInvocation {
  const suppliedTarget = suppliedArguments[AgentToolExecutionTargetArgument];
  if (suppliedTarget !== undefined && suppliedTarget !== executionPlan.target) {
    throw new AgentToolExecutionTargetError("invalid", tool.name, tool.execution.Targets, suppliedTarget);
  }
  const declaredPlan = createAgentToolExecutionPlan(tool.execution, executionPlan.target);
  if (!sameExecutionPlan(declaredPlan, executionPlan)) {
    throw new AgentToolExecutionPlanError(tool.name, executionPlan);
  }
  const arguments_ = { ...suppliedArguments };
  delete arguments_[AgentToolExecutionTargetArgument];
  return { arguments: arguments_, executionPlan: declaredPlan };
}

export function createAgentToolExecutionPlan(
  execution: ToolExecutionManifest,
  target: ToolExecutionTarget,
): AgentToolExecutionPlan {
  if (!execution.Targets.includes(target)) {
    throw new Error(`Execution target ${target} is not declared by this tool.`);
  }
  return {
    target,
    backend: BackendByTarget[target],
    network: NetworkByManifest[execution.Network],
    workspaceMount: WorkspaceMountByManifest[execution.Workspace],
    availableTargets: [...execution.Targets],
  };
}

export function projectAgentToolInvocationSchema(
  tool: RegisteredTool,
  schema: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (tool.execution.Targets.length === 1) return schema as Record<string, unknown>;
  const properties = readRecord(schema.properties);
  if (!properties) {
    throw new Error(`Tool ${tool.name} must expose an object input schema to select an execution target.`);
  }
  if (AgentToolExecutionTargetArgument in properties) {
    throw new Error(`Tool ${tool.name} reserves the ${AgentToolExecutionTargetArgument} argument.`);
  }
  const cached = InvocationSchemaProjectionCache.get(schema)?.get(tool.execution);
  if (cached) return cached;
  const required = readStringArray(schema.required);
  const projection = Object.freeze({
    ...schema,
    properties: Object.freeze({
      ...properties,
      [AgentToolExecutionTargetArgument]: {
        type: "string",
        enum: [...tool.execution.Targets],
        description: "选择此工具的执行目标。Sandbox 在隔离的 Linux 环境中运行；Local 在宿主本机环境中运行。",
      },
    }),
    required: Object.freeze([...new Set([...required, AgentToolExecutionTargetArgument])]),
  }) as Record<string, unknown>;
  const projections =
    InvocationSchemaProjectionCache.get(schema) ?? new WeakMap<ToolExecutionManifest, Record<string, unknown>>();
  projections.set(tool.execution, projection);
  InvocationSchemaProjectionCache.set(schema, projections);
  return projection;
}

function resolveExecutionTarget(tool: RegisteredTool, args: Readonly<Record<string, unknown>>): ToolExecutionTarget {
  const declared = tool.execution.Targets;
  const supplied = args[AgentToolExecutionTargetArgument];
  if (declared.length === 1) {
    if (supplied !== undefined && supplied !== declared[0]) {
      throw new AgentToolExecutionTargetError("invalid", tool.name, declared, supplied);
    }
    return declared[0]!;
  }
  if (supplied === undefined) {
    throw new AgentToolExecutionTargetError("missing", tool.name, declared);
  }
  if (typeof supplied !== "string" || !declared.includes(supplied as ToolExecutionTarget)) {
    throw new AgentToolExecutionTargetError("invalid", tool.name, declared, supplied);
  }
  return supplied as ToolExecutionTarget;
}

function executionTargetErrorMessage(
  kind: AgentToolExecutionTargetError["kind"],
  toolName: string,
  availableTargets: readonly ToolExecutionTarget[],
  value: unknown,
): string {
  const available = availableTargets.join(", ");
  if (kind === "missing") {
    return `Tool ${toolName} requires ${AgentToolExecutionTargetArgument}; choose one of: ${available}.`;
  }
  return `Tool ${toolName} does not support execution target ${JSON.stringify(value)}; available targets: ${available}.`;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sameExecutionPlan(left: AgentToolExecutionPlan, right: AgentToolExecutionPlan): boolean {
  return (
    left.target === right.target &&
    left.backend === right.backend &&
    left.network === right.network &&
    left.workspaceMount === right.workspaceMount &&
    left.availableTargets.length === right.availableTargets.length &&
    left.availableTargets.every((target, index) => target === right.availableTargets[index])
  );
}
