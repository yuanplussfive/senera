import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { SeneraProcessBackendPreference } from "../Execution/SeneraExecutionProfile.js";
import { ToolExecutionTargets, type ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { AgentMcpExecutionTargets, type AgentMcpExecution } from "./AgentMcpPackageSchema.js";
import type { AgentMcpPackage, AgentMcpPackageServer } from "./AgentMcpPackageTypes.js";

const ToolTargetByMcpTarget = {
  [AgentMcpExecutionTargets.Sandbox]: ToolExecutionTargets.Sandbox,
  [AgentMcpExecutionTargets.Local]: ToolExecutionTargets.Local,
} as const satisfies Record<
  (typeof AgentMcpExecutionTargets)[keyof typeof AgentMcpExecutionTargets],
  ToolExecutionTarget
>;

const BackendByToolTarget = {
  [ToolExecutionTargets.Sandbox]: "sandbox",
  [ToolExecutionTargets.Local]: "local",
} as const satisfies Record<ToolExecutionTarget, SeneraProcessBackendPreference>;

export interface AgentMcpPackageExecutionPolicy {
  readonly targets: readonly ToolExecutionTarget[];
  readonly preferred: ToolExecutionTarget;
  readonly preferredBackend: SeneraProcessBackendPreference;
}

type AgentMcpExecutionTarget = AgentMcpExecution["targets"][number];
type NonEmptyAgentMcpExecutionTargets = readonly [AgentMcpExecutionTarget, ...AgentMcpExecutionTarget[]];

/** The package requests targets; the host grants only persistent-process backends it provides. */
export function resolveAgentMcpPackageExecutionPolicy(
  package_: AgentMcpPackage,
  server: AgentMcpPackageServer,
  executionEnv: Pick<SeneraExecutionEnv, "capabilities">,
): AgentMcpPackageExecutionPolicy {
  if (server.configuration.type === "http") {
    return {
      targets: [ToolExecutionTargets.Local],
      preferred: ToolExecutionTargets.Local,
      preferredBackend: "local",
    };
  }
  const requested = package_.execution;
  if (!requested)
    throw new Error(`MCP package ${package_.name} must declare execution for stdio server ${server.name}.`);
  const supported = new Set(executionEnv.capabilities.persistentProcessBackends);
  const [firstGranted, ...remainingGranted] = requested.targets.filter((target) => supported.has(target));
  if (firstGranted === undefined) {
    throw new Error(
      `MCP package ${package_.name} requests ${formatTargets(requested.targets)}, but this host supports ${formatTargets(
        executionEnv.capabilities.persistentProcessBackends,
      )}.`,
    );
  }
  const granted: NonEmptyAgentMcpExecutionTargets = [firstGranted, ...remainingGranted];
  const ordered = orderTargets(granted, requested.preferred);
  const preferred = ToolTargetByMcpTarget[ordered[0]];
  return {
    targets: ordered.map((target) => ToolTargetByMcpTarget[target]),
    preferred,
    preferredBackend: BackendByToolTarget[preferred],
  };
}

function orderTargets(
  granted: NonEmptyAgentMcpExecutionTargets,
  preferred: AgentMcpExecution["preferred"],
): NonEmptyAgentMcpExecutionTargets {
  return granted.includes(preferred) ? [preferred, ...granted.filter((target) => target !== preferred)] : [...granted];
}

function formatTargets(targets: readonly string[]): string {
  return targets.length > 0 ? targets.join(", ") : "none";
}
