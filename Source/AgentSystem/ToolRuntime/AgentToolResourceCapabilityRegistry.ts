import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolResourceProjection } from "./AgentToolResourceArgumentProjector.js";
import type { AgentToolResourceClaim, AgentToolResourceClaimDeclaration } from "./AgentToolResourceClaimTypes.js";
import type { AgentResourceAccessRequest } from "../Execution/SeneraResourceAccess.js";

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
  inspect?(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }): Promise<readonly AgentResourceAccessRequest[]>;
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

  async claimDeclaration(declaration: AgentToolResourceClaimDeclaration): Promise<readonly AgentToolResourceClaim[]> {
    const parameters = declaration.parameters ? { ...declaration.parameters } : {};
    if (declaration.intent !== undefined) {
      const existingIntent = parameters.Intent;
      if (existingIntent !== undefined && existingIntent !== declaration.intent) {
        throw new TypeError(
          `Resource declaration intent conflicts with its capability parameters: ${declaration.capability}.`,
        );
      }
      parameters.Intent = declaration.intent;
    }
    const resource: ToolResourceArgumentManifest = {
      Capability: declaration.capability,
      Pointer: "/value",
      ...(Object.keys(parameters).length > 0 ? { Parameters: parameters } : {}),
    };
    return (await this.claim(resource, declaration.value, { value: declaration.value })) ?? [];
  }

  async inspect(
    resource: ToolResourceArgumentManifest,
    value: unknown,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly AgentResourceAccessRequest[]> {
    const capability = this.capabilities.get(resource.Capability);
    if (!capability) throw new Error(`Tool resource capability is not available: ${resource.Capability}`);
    return capability.inspect?.({ resource, value, args }) ?? [];
  }
}
