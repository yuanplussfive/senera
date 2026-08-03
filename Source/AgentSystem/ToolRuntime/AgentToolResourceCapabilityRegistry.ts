import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolResourceProjection } from "./AgentToolResourceArgumentProjector.js";
import type { AgentToolResourceClaim } from "./AgentToolResourceClaimTypes.js";

export interface AgentToolResourceCapability {
  readonly id: string;
  project(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }): Promise<AgentToolResourceProjection>;
  claim?(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }): Promise<readonly AgentToolResourceClaim[]>;
}

export class AgentToolResourceCapabilityRegistry {
  private readonly capabilities = new Map<string, AgentToolResourceCapability>();

  register(capability: AgentToolResourceCapability): this {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Duplicate tool resource capability: ${capability.id}`);
    }
    this.capabilities.set(capability.id, capability);
    return this;
  }

  async project(
    resource: ToolResourceArgumentManifest,
    value: unknown,
    args: Readonly<Record<string, unknown>>,
  ): Promise<AgentToolResourceProjection> {
    const capability = this.capabilities.get(resource.Capability);
    if (!capability) throw new Error(`Tool resource capability is not available: ${resource.Capability}`);
    return capability.project({ resource, value, args });
  }

  async claim(
    resource: ToolResourceArgumentManifest,
    value: unknown,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly AgentToolResourceClaim[] | undefined> {
    const capability = this.capabilities.get(resource.Capability);
    if (!capability) throw new Error(`Tool resource capability is not available: ${resource.Capability}`);
    return capability.claim?.({ resource, value, args });
  }
}
