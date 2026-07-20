import type { ToolHandlerManifest, ToolRuntimeManifest } from "./PluginToolManifestTypes.js";

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
    protocol: { kind: "required", version: 2 },
  },
  McpTool: {
    lifecycles: ["Immediate", "OneShot", "Persistent", "RemoteJob"],
    protocol: { kind: "forbidden" },
  },
} as const satisfies Record<ToolHandlerKind, ToolHandlerRuntimeContract>;

export interface PluginToolRuntimeContractIssue {
  field: "handler" | "lifecycle" | "protocolVersion";
  message: string;
}

export interface PluginToolRuntimeCapabilityContractIssue {
  capability: ToolRuntimeCapability;
  message: string;
}

interface ToolRuntimeCapabilityRule {
  capability: ToolRuntimeCapability;
  matches: (input: PluginToolRuntimeCapabilityContractInput) => boolean;
  message: string;
}

interface PluginToolRuntimeCapabilityContractInput {
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

export function inspectPluginToolRuntimeContract(input: {
  handlerKind: string;
  lifecycle: string;
  protocolVersion?: number;
}): PluginToolRuntimeContractIssue[] {
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

export function inspectPluginToolRuntimeCapabilityContract(
  input: PluginToolRuntimeCapabilityContractInput,
): PluginToolRuntimeCapabilityContractIssue[] {
  return ToolRuntimeCapabilityRules.filter((rule) => rule.matches(input)).map((rule) => ({
    capability: rule.capability,
    message: rule.message,
  }));
}

function readHandlerContract(handlerKind: string): ToolHandlerRuntimeContract | undefined {
  return Object.hasOwn(ToolRuntimeContractByHandler, handlerKind)
    ? ToolRuntimeContractByHandler[handlerKind as ToolHandlerKind]
    : undefined;
}

function inspectProtocolContract(
  input: { handlerKind: string; protocolVersion?: number },
  contract: ToolHandlerRuntimeContract["protocol"],
): PluginToolRuntimeContractIssue[] {
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
