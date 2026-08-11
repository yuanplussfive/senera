import {
  AgentHostToolProtocolVersion,
  ToolSchedulingModes,
  type ToolHandlerManifest,
  type ToolRuntimeManifest,
} from "./AgentToolContractTypes.js";

type ToolHandlerKind = ToolHandlerManifest["Kind"];
type ToolLifecycle = ToolRuntimeManifest["Lifecycle"];
type ToolRuntimeCapability = keyof NonNullable<ToolRuntimeManifest["Capabilities"]>;

interface RequiredProtocolContract {
  kind: "required";
  version: NonNullable<ToolRuntimeManifest["ProtocolVersion"]>;
}

interface ForbiddenProtocolContract {
  kind: "forbidden";
}

interface ToolHandlerRuntimeContract {
  lifecycles: readonly ToolLifecycle[];
  protocol: RequiredProtocolContract | ForbiddenProtocolContract;
}

export const ToolRuntimeContractByHandler = {
  HostCapability: {
    lifecycles: ["Immediate", "OneShot", "Persistent", "RemoteJob"],
    protocol: { kind: "required", version: AgentHostToolProtocolVersion },
  },
  McpTool: {
    lifecycles: ["Immediate", "OneShot", "Persistent", "RemoteJob"],
    protocol: { kind: "forbidden" },
  },
} as const satisfies Record<ToolHandlerKind, ToolHandlerRuntimeContract>;

export interface AgentToolRuntimeContractIssue {
  field: "handler" | "lifecycle" | "protocolVersion";
  message: string;
}

export interface AgentToolRuntimeCapabilityContractIssue {
  capability: ToolRuntimeCapability;
  message: string;
}

export interface AgentToolSchedulingContractIssue {
  field: "scheduling" | "maxConcurrency" | "resources";
  message: string;
}

interface ToolRuntimeCapabilityRule {
  capability: ToolRuntimeCapability;
  matches: (input: AgentToolRuntimeCapabilityContractInput) => boolean;
  message: string;
}

interface AgentToolRuntimeCapabilityContractInput {
  handlerKind: string;
  lifecycle: string;
  capabilities?: ToolRuntimeManifest["Capabilities"];
}

const ToolRuntimeCapabilityRules = [
  {
    capability: "Cancellation",
    matches: (input) => input.lifecycle === "RemoteJob" && input.capabilities?.Cancellation !== true,
    message: "RemoteJob requires Capabilities.Cancellation=true.",
  },
  {
    capability: "ResumableEvents",
    matches: (input) =>
      input.handlerKind === "McpTool" &&
      input.capabilities?.ResumableEvents === true &&
      (input.lifecycle !== "RemoteJob" ||
        (input.capabilities.Progress !== true && input.capabilities.OutputStreaming !== true)),
    message: "McpTool ResumableEvents requires RemoteJob and at least one of Progress or OutputStreaming.",
  },
] as const satisfies readonly ToolRuntimeCapabilityRule[];

export function inspectAgentToolRuntimeContract(input: {
  handlerKind: string;
  lifecycle: string;
  protocolVersion?: number;
}): AgentToolRuntimeContractIssue[] {
  const contract = readHandlerContract(input.handlerKind);
  if (!contract) {
    return [{ field: "handler", message: `Unsupported tool handler ${input.handlerKind || "<unspecified>"}.` }];
  }

  const lifecycleIssues = contract.lifecycles.includes(input.lifecycle as ToolLifecycle)
    ? []
    : [
        {
          field: "lifecycle" as const,
          message: `${input.handlerKind} does not support lifecycle ${input.lifecycle || "<unspecified>"}.`,
        },
      ];
  return [...lifecycleIssues, ...inspectProtocolContract(input, contract.protocol)];
}

export function inspectAgentToolRuntimeCapabilityContract(
  input: AgentToolRuntimeCapabilityContractInput,
): AgentToolRuntimeCapabilityContractIssue[] {
  return ToolRuntimeCapabilityRules.filter((rule) => rule.matches(input)).map((rule) => ({
    capability: rule.capability,
    message: rule.message,
  }));
}

export function inspectAgentToolSchedulingContract(input: {
  handlerKind: string;
  scheduling?: string;
  maxConcurrency?: number;
  resourceCount: number;
}): AgentToolSchedulingContractIssue[] {
  const scheduling = input.scheduling ?? ToolSchedulingModes.Parallel;
  const issues: AgentToolSchedulingContractIssue[] = [];
  if (
    scheduling === ToolSchedulingModes.ResourceClaims &&
    input.handlerKind === "HostCapability" &&
    input.resourceCount === 0
  ) {
    issues.push({
      field: "resources",
      message: "HostCapability ResourceClaims scheduling requires at least one resource declaration.",
    });
  }
  if (scheduling !== ToolSchedulingModes.ResourceClaims && input.resourceCount > 0) {
    issues.push({
      field: "resources",
      message: `Tool resources require ${ToolSchedulingModes.ResourceClaims} scheduling.`,
    });
  }
  if (scheduling === ToolSchedulingModes.SelfManaged && input.maxConcurrency !== undefined) {
    issues.push({
      field: "maxConcurrency",
      message: "SelfManaged scheduling owns its concurrency and must not declare MaxConcurrency.",
    });
  }
  return issues;
}

function readHandlerContract(handlerKind: string): ToolHandlerRuntimeContract | undefined {
  return Object.hasOwn(ToolRuntimeContractByHandler, handlerKind)
    ? ToolRuntimeContractByHandler[handlerKind as ToolHandlerKind]
    : undefined;
}

function inspectProtocolContract(
  input: { handlerKind: string; protocolVersion?: number },
  contract: ToolHandlerRuntimeContract["protocol"],
): AgentToolRuntimeContractIssue[] {
  switch (contract.kind) {
    case "required":
      return input.protocolVersion === contract.version
        ? []
        : [
            {
              field: "protocolVersion",
              message: `${input.handlerKind} requires private tool protocol version ${contract.version}.`,
            },
          ];
    case "forbidden":
      return input.protocolVersion === undefined
        ? []
        : [
            {
              field: "protocolVersion",
              message: `${input.handlerKind} uses its native protocol and must not declare a private tool protocol version.`,
            },
          ];
  }
}
