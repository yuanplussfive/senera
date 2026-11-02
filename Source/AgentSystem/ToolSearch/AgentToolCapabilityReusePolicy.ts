import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

export const AgentToolCapabilityReuseModes = {
  Automatic: "automatic",
  Proposal: "proposal",
} as const;

export type AgentToolCapabilityReuseMode =
  (typeof AgentToolCapabilityReuseModes)[keyof typeof AgentToolCapabilityReuseModes];

export interface AgentToolCapabilityReusePolicy {
  readonly mode: AgentToolCapabilityReuseMode;
  readonly reasons: readonly string[];
}

const SafeEffects = new Set(["none", "read-only", "read-state"]);
const SafeSideEffects = new Set(["none", "read-only"]);

/**
 * Turns a tool's declared contract into a reuse decision. Reuse is a
 * convenience for constructing the next invocation, never a bypass of the
 * normal approval or execution pipeline.
 */
export function resolveAgentToolCapabilityReusePolicy(tool: RegisteredTool): AgentToolCapabilityReusePolicy {
  const capabilities = tool.search?.Capabilities ?? [];
  const effects = capabilities.flatMap((capability) => capability.Facets?.Effects ?? []);
  const sideEffects = capabilities
    .map((capability) => capability.Risk?.SideEffect)
    .filter((value): value is string => Boolean(value));
  const reasons = [
    ...(effects.length === 0 ? ["tool does not declare capability effects"] : []),
    ...(effects.some((effect) => !SafeEffects.has(effect)) ? ["capability declares a non-read effect"] : []),
    ...(sideEffects.some((sideEffect) => !SafeSideEffects.has(sideEffect))
      ? ["capability declares a side effect"]
      : []),
    ...(tool.handler.kind === "McpTool" && !tool.handler.readOnly ? ["MCP handler is not read-only"] : []),
    ...(tool.handler.kind === "HostCapability" && tool.execution.Workspace !== "ReadOnly"
      ? ["host execution can write the workspace"]
      : []),
    ...(tool.handler.kind === "HostCapability" && tool.execution.Network !== "Deny"
      ? ["host execution can access the network"]
      : []),
    ...((tool.approval?.Mode ?? "allow") !== "allow" ? ["tool requires an approval decision"] : []),
  ];
  return reasons.length === 0
    ? { mode: AgentToolCapabilityReuseModes.Automatic, reasons: ["declared read-only and approval-safe"] }
    : { mode: AgentToolCapabilityReuseModes.Proposal, reasons };
}
