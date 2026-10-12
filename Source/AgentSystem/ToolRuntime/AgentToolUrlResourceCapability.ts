import { z } from "zod";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type {
  AgentToolResourceCapability,
  AgentToolResourceManifestValidator,
} from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import { AgentToolResourceQueryShapes } from "./AgentToolResourceDiscovery.js";

const UrlParametersSchema = z.object({}).strict();

export const AgentToolUrlResourceManifestValidator: AgentToolResourceManifestValidator = Object.freeze({
  id: AgentToolResourceCapabilityIds.NetworkUrl,
  validateManifest(resource: ToolResourceArgumentManifest) {
    if (resource.Binding !== undefined) {
      throw new TypeError(`${AgentToolResourceCapabilityIds.NetworkUrl} does not support resource bindings.`);
    }
    UrlParametersSchema.parse(resource.Parameters ?? {});
  },
});

/**
 * Declares a URL as a first-class tool resource without changing the
 * address chosen by the caller. The owning browser or web tool remains the
 * authority for scheme, host, and network-policy validation.
 */
export class AgentToolUrlResourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.NetworkUrl;
  readonly discovery = { queryShapes: [AgentToolResourceQueryShapes.Url] };

  validateManifest(resource: ToolResourceArgumentManifest): void {
    AgentToolUrlResourceManifestValidator.validateManifest(resource);
  }

  async project(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }) {
    this.validateManifest(input.resource);
    if (typeof input.value !== "string" || input.value.trim().length === 0) {
      throw new TypeError(`URL resource ${input.resource.Pointer} must be a non-empty string.`);
    }
    return { target: "argument" as const, value: input.value };
  }
}
