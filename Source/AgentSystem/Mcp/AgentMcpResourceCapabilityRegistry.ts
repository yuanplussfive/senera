import type { ToolResourceArgumentManifest } from "../Types/PluginToolManifestTypes.js";
import type { AgentMcpResourceProjection } from "./AgentMcpResourceArgumentProjector.js";

export interface AgentMcpResourceCapability {
  readonly id: string;
  project(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }): Promise<AgentMcpResourceProjection>;
}

export class AgentMcpResourceCapabilityRegistry {
  private readonly capabilities = new Map<string, AgentMcpResourceCapability>();

  register(capability: AgentMcpResourceCapability): this {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Duplicate MCP resource capability: ${capability.id}`);
    }
    this.capabilities.set(capability.id, capability);
    return this;
  }

  async project(
    resource: ToolResourceArgumentManifest,
    value: unknown,
    args: Readonly<Record<string, unknown>>,
  ): Promise<AgentMcpResourceProjection> {
    const capability = this.capabilities.get(resource.Capability);
    if (!capability) throw new Error(`MCP resource capability is not available: ${resource.Capability}`);
    return capability.project({ resource, value, args });
  }
}
