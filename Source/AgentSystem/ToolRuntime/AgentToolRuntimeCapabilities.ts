import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { ToolRuntimeCapabilitiesManifest, ToolRuntimeManifest } from "../Types/PluginManifestTypes.js";
import {
  inspectPluginToolRuntimeCapabilityContract,
  inspectPluginToolRuntimeContract,
} from "../Types/PluginToolRuntimeContract.js";

export interface AgentToolRuntimeCapabilities {
  lifecycle: "immediate" | "one-shot" | "persistent" | "remote-job";
  protocolVersion?: ToolRuntimeManifest["ProtocolVersion"];
  progress: boolean;
  outputStreaming: boolean;
  interactiveInput: boolean;
  cancellation: boolean;
  resumableEvents: boolean;
}

const LifecycleProjection = {
  Immediate: "immediate",
  OneShot: "one-shot",
  Persistent: "persistent",
  RemoteJob: "remote-job",
} as const satisfies Record<ToolRuntimeManifest["Lifecycle"], AgentToolRuntimeCapabilities["lifecycle"]>;

export function resolveAgentToolRuntimeCapabilities(tool: RegisteredTool): AgentToolRuntimeCapabilities {
  const runtime = tool.runtime;
  const capabilities = runtime.Capabilities ?? {};
  return {
    lifecycle: LifecycleProjection[runtime.Lifecycle],
    protocolVersion: runtime.ProtocolVersion,
    progress: enabled(capabilities, "Progress"),
    outputStreaming: enabled(capabilities, "OutputStreaming"),
    interactiveInput: enabled(capabilities, "InteractiveInput"),
    cancellation: enabled(capabilities, "Cancellation"),
    resumableEvents: enabled(capabilities, "ResumableEvents"),
  };
}

export function explainUnsupportedAgentToolRuntime(tool: RegisteredTool): string[] {
  return [
    ...inspectPluginToolRuntimeContract({
      handlerKind: tool.handler.kind,
      lifecycle: tool.runtime.Lifecycle,
      protocolVersion: tool.runtime.ProtocolVersion,
    }),
    ...inspectPluginToolRuntimeCapabilityContract({
      handlerKind: tool.handler.kind,
      lifecycle: tool.runtime.Lifecycle,
      capabilities: tool.runtime.Capabilities,
    }),
  ].map((issue) => issue.message);
}

function enabled(
  capabilities: ToolRuntimeCapabilitiesManifest,
  capability: keyof ToolRuntimeCapabilitiesManifest,
): boolean {
  return capabilities[capability] === true;
}
