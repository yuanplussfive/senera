import { z } from "zod";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import type {
  AgentToolResourceCapability,
  AgentToolResourceCapabilityRegistry,
  AgentToolResourceManifestValidator,
} from "./AgentToolResourceCapabilityRegistry.js";

const DeclarationsSchema = z
  .array(
    z
      .object({
        capability: z
          .string()
          .trim()
          .min(1)
          .refine(
            (value) => value !== AgentToolResourceCapabilityIds.Declarations,
            "Resource declarations cannot recursively contain declarations.",
          ),
        value: z.unknown(),
        intent: z.string().trim().min(1).optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  )
  .min(1);

export const AgentToolResourceDeclarationsManifestValidator: AgentToolResourceManifestValidator = Object.freeze({
  id: AgentToolResourceCapabilityIds.Declarations,
  validateManifest(resource: ToolResourceArgumentManifest) {
    if (resource.Binding !== undefined || Object.keys(resource.Parameters ?? {}).length)
      throw new TypeError("Resource declarations do not accept bindings or parameters.");
  },
});

/** Makes assignment declarations visible to the same gate as ordinary tool paths. */
export class AgentToolResourceDeclarationsCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.Declarations;

  constructor(private readonly capabilities: AgentToolResourceCapabilityRegistry) {}

  validateManifest(resource: ToolResourceArgumentManifest): void {
    AgentToolResourceDeclarationsManifestValidator.validateManifest(resource);
  }

  async project(input: { value: unknown }) {
    return { target: "argument" as const, value: DeclarationsSchema.parse(input.value) };
  }

  async inspect(input: { value: unknown }) {
    const declarations = DeclarationsSchema.parse(input.value);
    return (
      await Promise.all(declarations.map((declaration) => this.capabilities.inspectDeclaration(declaration)))
    ).flat();
  }
}
