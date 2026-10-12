import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolResourceProjection } from "./AgentToolResourceArgumentProjector.js";
import type { AgentToolResourceClaim, AgentToolResourceClaimDeclaration } from "./AgentToolResourceClaimTypes.js";
import type { AgentResourceAccessRequest } from "../Execution/SeneraResourceAccess.js";
import type { AgentToolResourceDiscovery, AgentToolResourceDiscoveryReader } from "./AgentToolResourceDiscovery.js";

/**
 * Stateless validation owned by a resource capability. It runs while package
 * contracts are loaded, before an invocation can reach the runtime projector.
 */
export interface AgentToolResourceManifestValidator {
  readonly id: string;
  validateManifest(resource: ToolResourceArgumentManifest): void;
}

export interface AgentToolResourceCapability {
  readonly id: string;
  /**
   * Capabilities with package-visible parameters provide the same validation
   * during contract loading and at invocation time. Custom runtime-only
   * capabilities may omit this until they are made package-declarable.
   */
  validateManifest?(resource: ToolResourceArgumentManifest): void;
  readonly discovery?: AgentToolResourceDiscovery;
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

/**
 * Registry for the static, package-facing half of resource capabilities.
 * It deliberately knows capability declarations, not individual tool names.
 */
export class AgentToolResourceManifestValidatorRegistry {
  private readonly validators = new Map<string, AgentToolResourceManifestValidator>();

  register(validator: AgentToolResourceManifestValidator): this {
    if (this.validators.has(validator.id)) {
      throw new Error(`Duplicate tool resource manifest validator: ${validator.id}`);
    }
    this.validators.set(validator.id, validator);
    return this;
  }

  validate(resource: ToolResourceArgumentManifest): void {
    const validator = this.validators.get(resource.Capability);
    if (!validator) {
      throw new Error(`Tool resource capability has no manifest validator: ${resource.Capability}`);
    }
    validator.validateManifest(resource);
  }

  validateAll(resources: readonly ToolResourceArgumentManifest[]): void {
    for (const [index, resource] of resources.entries()) {
      try {
        this.validate(resource);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Invalid tool resource declaration at resources[${index}] for ${resource.Capability}: ${message}`,
          { cause: error },
        );
      }
    }
  }
}

export class AgentToolResourceCapabilityRegistry implements AgentToolResourceDiscoveryReader {
  private readonly capabilities = new Map<string, AgentToolResourceCapability>();

  register(capability: AgentToolResourceCapability): this {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Duplicate tool resource capability: ${capability.id}`);
    }
    this.capabilities.set(capability.id, capability);
    return this;
  }

  getDiscovery(capabilityId: string): AgentToolResourceDiscovery | undefined {
    return this.capabilities.get(capabilityId)?.discovery;
  }

  listCapabilityIds(): readonly string[] {
    return [...this.capabilities.keys()].sort();
  }

  listClaimCapabilityIds(): readonly string[] {
    return [...this.capabilities.values()]
      .filter((capability) => capability.claim !== undefined)
      .map((capability) => capability.id)
      .sort();
  }

  validateManifest(resource: ToolResourceArgumentManifest): void {
    const capability = this.requireCapability(resource.Capability);
    if (!capability.validateManifest) {
      throw new Error(`Tool resource capability has no manifest validator: ${resource.Capability}`);
    }
    capability.validateManifest(resource);
  }

  async project(
    resource: ToolResourceArgumentManifest,
    value: unknown,
    args: Readonly<Record<string, unknown>>,
  ): Promise<AgentToolResourceProjection> {
    const capability = this.requireCapability(resource.Capability);
    return capability.project({ resource, value, args });
  }

  async claim(
    resource: ToolResourceArgumentManifest,
    value: unknown,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly AgentToolResourceClaim[] | undefined> {
    const capability = this.requireCapability(resource.Capability);
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
    const capability = this.requireCapability(resource.Capability);
    return capability.inspect?.({ resource, value, args }) ?? [];
  }

  private requireCapability(capabilityId: string): AgentToolResourceCapability {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw new Error(`Tool resource capability is not available: ${capabilityId}`);
    return capability;
  }
}
