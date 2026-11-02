import { z } from "zod";
import { AgentResourceSourceSchema } from "../Resources/AgentResourceSource.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import { AgentToolResourceQueryShapes } from "./AgentToolResourceDiscovery.js";
import type {
  AgentToolResourceCapability,
  AgentToolResourceCapabilityRegistry,
  AgentToolResourceManifestValidator,
} from "./AgentToolResourceCapabilityRegistry.js";

const SourcesSchema = z.union([AgentResourceSourceSchema, z.array(AgentResourceSourceSchema).min(1)]);

export const AgentToolResourceSourceManifestValidator: AgentToolResourceManifestValidator = Object.freeze({
  id: AgentToolResourceCapabilityIds.Source,
  validateManifest(resource: ToolResourceArgumentManifest) {
    if (resource.Binding !== undefined || Object.keys(resource.Parameters ?? {}).length)
      throw new TypeError("Resource sources do not accept bindings or parameters.");
  },
});

/** Applies ordinary path authorization to local inputs in the shared source union. */
export class AgentToolResourceSourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.Source;
  readonly discovery = { queryShapes: [AgentToolResourceQueryShapes.Path, AgentToolResourceQueryShapes.Url] };

  constructor(private readonly capabilities: AgentToolResourceCapabilityRegistry) {}

  validateManifest(resource: ToolResourceArgumentManifest): void {
    AgentToolResourceSourceManifestValidator.validateManifest(resource);
  }

  async project(input: { resource: ToolResourceArgumentManifest; value: unknown }) {
    this.validateManifest(input.resource);
    return { target: "argument" as const, value: SourcesSchema.parse(input.value) };
  }

  async inspect(input: { resource: ToolResourceArgumentManifest; value: unknown }) {
    this.validateManifest(input.resource);
    const parsed = SourcesSchema.parse(input.value);
    const sources = Array.isArray(parsed) ? parsed : [parsed];
    return (
      await Promise.all(
        sources.flatMap((source) =>
          source.kind === "local_path"
            ? [
                this.capabilities.inspectDeclaration({
                  capability: AgentToolResourceCapabilityIds.WorkspacePath,
                  value: source.path,
                  intent: AgentResourceAccessIntents.Read,
                }),
              ]
            : [],
        ),
      )
    ).flat();
  }
}
