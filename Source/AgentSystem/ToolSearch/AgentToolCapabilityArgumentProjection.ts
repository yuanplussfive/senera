import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  AgentToolCapabilityReuseModes,
  resolveAgentToolCapabilityReusePolicy,
} from "./AgentToolCapabilityReusePolicy.js";
import type { AgentToolCapabilityCacheEntry } from "./AgentToolCapabilitySessionCache.js";

/**
 * Completes an invocation from the current turn's host-confirmed evidence.
 * Explicit model arguments always win; the projection is never an execution
 * shortcut and the normal contract, approval, and resource checks still run.
 */
export function projectAgentToolCapabilityArguments(
  tool: RegisteredTool,
  suppliedArguments: Readonly<Record<string, unknown>>,
  reusableCapabilities: readonly AgentToolCapabilityCacheEntry[] | undefined,
): Record<string, unknown> {
  const policy = resolveAgentToolCapabilityReusePolicy(tool);
  if (policy.mode !== AgentToolCapabilityReuseModes.Automatic || !reusableCapabilities) {
    return { ...suppliedArguments };
  }
  const entry = reusableCapabilities.find(
    (candidate) =>
      candidate.toolName === tool.name && candidate.contractDigest === tool.contract?.digest && candidate.arguments,
  );
  return entry?.arguments ? { ...entry.arguments, ...suppliedArguments } : { ...suppliedArguments };
}
