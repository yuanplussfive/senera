import {
  ToolLoadingModes,
  ToolPlanningModes,
  type ToolLoadingMode,
  type ToolPlanningMode,
} from "../Types/AgentToolContractTypes.js";

/**
 * The loading declaration is the single owner of a tool's model-facing
 * invocation route. It deliberately does not inspect extension names,
 * packages, or host capability identifiers.
 */
export const AgentToolInvocationRoutes = {
  Direct: "direct",
  Discovery: "discovery",
} as const;

export type AgentToolInvocationRoute = (typeof AgentToolInvocationRoutes)[keyof typeof AgentToolInvocationRoutes];

export interface AgentToolInvocationRoutingSubject {
  readonly loading: ToolLoadingMode;
  /** Omitted declarations are portable across every registered planning protocol. */
  readonly planningModes?: readonly ToolPlanningMode[];
}

export interface AgentToolInvocationRoutePartition<T> {
  readonly direct: readonly T[];
  readonly discovery: readonly T[];
}

const RouteByLoading: Readonly<Record<ToolLoadingMode, AgentToolInvocationRoute>> = Object.freeze({
  [ToolLoadingModes.Bootstrap]: AgentToolInvocationRoutes.Direct,
  [ToolLoadingModes.Dynamic]: AgentToolInvocationRoutes.Discovery,
});

export function resolveAgentToolInvocationRoute(tool: AgentToolInvocationRoutingSubject): AgentToolInvocationRoute {
  const route = RouteByLoading[tool.loading];
  if (!route) throw new Error(`Unknown tool loading declaration: ${String(tool.loading)}.`);
  return route;
}

/**
 * Packages may opt into a subset when a management contract only exists for
 * one planner protocol. Omission is a deliberate portable-contract default,
 * not a name- or package-based compatibility branch.
 */
export function resolveAgentToolPlanningModes(tool: AgentToolInvocationRoutingSubject): readonly ToolPlanningMode[] {
  const declared = tool.planningModes;
  if (declared === undefined) return ToolPlanningModes;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error("Tool planningModes must contain at least one supported planning mode.");
  }
  const supported = new Set<ToolPlanningMode>(ToolPlanningModes);
  const seen = new Set<ToolPlanningMode>();
  for (const mode of declared) {
    if (!supported.has(mode)) throw new Error(`Unknown tool planning mode: ${String(mode)}.`);
    if (seen.has(mode)) throw new Error(`Tool planningModes must not repeat ${mode}.`);
    seen.add(mode);
  }
  return declared;
}

export function isAgentToolSupportedByPlanningMode(
  tool: AgentToolInvocationRoutingSubject,
  planningMode: ToolPlanningMode,
): boolean {
  return resolveAgentToolPlanningModes(tool).includes(planningMode);
}

/** Validates both dimensions at extension registration time. */
export function validateAgentToolInvocationRouting(tool: AgentToolInvocationRoutingSubject): void {
  resolveAgentToolInvocationRoute(tool);
  resolveAgentToolPlanningModes(tool);
}

export function isAgentToolDirectlyInvocable(tool: AgentToolInvocationRoutingSubject): boolean {
  return resolveAgentToolInvocationRoute(tool) === AgentToolInvocationRoutes.Direct;
}

export function isAgentToolDynamicallyDiscoverable(tool: AgentToolInvocationRoutingSubject): boolean {
  return resolveAgentToolInvocationRoute(tool) === AgentToolInvocationRoutes.Discovery;
}

export function partitionAgentToolsByInvocationRoute<T extends AgentToolInvocationRoutingSubject>(
  tools: readonly T[],
): AgentToolInvocationRoutePartition<T> {
  const direct: T[] = [];
  const discovery: T[] = [];
  for (const tool of tools) {
    (isAgentToolDirectlyInvocable(tool) ? direct : discovery).push(tool);
  }
  return { direct, discovery };
}
