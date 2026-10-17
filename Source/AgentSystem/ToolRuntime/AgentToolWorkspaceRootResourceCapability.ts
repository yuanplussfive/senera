import path from "node:path";
import { z } from "zod";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type {
  AgentToolResourceCapability,
  AgentToolResourceManifestValidator,
} from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import { AgentToolResourceAccessModes } from "./AgentToolResourceClaimTypes.js";
import { AgentWorkspacePathClaimDomain } from "./AgentToolWorkspacePathResourceCapability.js";

const RootParametersSchema = z
  .object({
    Intent: z.enum(["inspect", "read", "create", "replace", "remove", "execute"]),
  })
  .strict();

interface WorkspaceRootResourceInput {
  resource: ToolResourceArgumentManifest;
  value: unknown;
  args: Readonly<Record<string, unknown>>;
}

export const AgentToolWorkspaceRootResourceManifestValidator: AgentToolResourceManifestValidator = Object.freeze({
  id: AgentToolResourceCapabilityIds.WorkspaceRoot,
  validateManifest(resource: ToolResourceArgumentManifest) {
    parseWorkspaceRootIntent(resource);
  },
});

/**
 * Declares an exclusive claim for the whole workspace without adding a
 * model-facing path argument. The empty RFC 6901 pointer addresses the tool
 * argument object; the value itself is deliberately ignored.
 */
export class AgentToolWorkspaceRootResourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.WorkspaceRoot;

  constructor(private readonly executionEnv: Pick<SeneraExecutionEnv, "workspaceRoot" | "inspectResourcePath">) {}

  validateManifest(resource: ToolResourceArgumentManifest): void {
    AgentToolWorkspaceRootResourceManifestValidator.validateManifest(resource);
  }

  async project(input: WorkspaceRootResourceInput) {
    parseWorkspaceRootIntent(input.resource);
    return { target: "argument" as const, value: input.value };
  }

  async claim(input: WorkspaceRootResourceInput) {
    const intent = parseWorkspaceRootIntent(input.resource);
    return [
      {
        domain: AgentWorkspacePathClaimDomain,
        identity: path.resolve(this.executionEnv.workspaceRoot),
        access: sharedWorkspaceIntent(intent)
          ? AgentToolResourceAccessModes.Shared
          : AgentToolResourceAccessModes.Exclusive,
      },
    ];
  }

  async inspect(input: WorkspaceRootResourceInput) {
    const intent = parseWorkspaceRootIntent(input.resource);
    return [await this.executionEnv.inspectResourcePath(".", intent)];
  }
}

function parseWorkspaceRootIntent(resource: ToolResourceArgumentManifest): AgentResourceAccessIntent {
  if (resource.Binding !== undefined) {
    throw new TypeError(`${AgentToolResourceCapabilityIds.WorkspaceRoot} does not support resource bindings.`);
  }
  return RootParametersSchema.parse(resource.Parameters ?? {}).Intent;
}

function sharedWorkspaceIntent(intent: AgentResourceAccessIntent): boolean {
  return (
    intent === AgentResourceAccessIntents.Inspect ||
    intent === AgentResourceAccessIntents.Read ||
    intent === AgentResourceAccessIntents.Execute
  );
}
