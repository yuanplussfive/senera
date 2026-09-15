import path from "node:path";
import { z } from "zod";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolResourceCapability } from "./AgentToolResourceCapabilityRegistry.js";
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

/**
 * Declares an exclusive claim for the whole workspace without adding a
 * model-facing path argument. The empty RFC 6901 pointer addresses the tool
 * argument object; the value itself is deliberately ignored.
 */
export class AgentToolWorkspaceRootResourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.WorkspaceRoot;

  constructor(private readonly executionEnv: Pick<SeneraExecutionEnv, "workspaceRoot" | "inspectResourcePath">) {}

  async project(input: WorkspaceRootResourceInput) {
    this.assertParameters(input);
    return { target: "argument" as const, value: input.value };
  }

  async claim(input: WorkspaceRootResourceInput) {
    const intent = this.assertParameters(input);
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
    const intent = this.assertParameters(input);
    return [await this.executionEnv.inspectResourcePath(".", intent)];
  }

  private assertParameters(input: WorkspaceRootResourceInput): AgentResourceAccessIntent {
    return RootParametersSchema.parse(input.resource.Parameters ?? {}).Intent;
  }
}

function sharedWorkspaceIntent(intent: AgentResourceAccessIntent): boolean {
  return (
    intent === AgentResourceAccessIntents.Inspect ||
    intent === AgentResourceAccessIntents.Read ||
    intent === AgentResourceAccessIntents.Execute
  );
}
