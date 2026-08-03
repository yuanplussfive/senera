import { z } from "zod";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolResourceCapability } from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import { readAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import { AgentToolResourceAccessModes, type AgentToolResourceClaimDomain } from "./AgentToolResourceClaimTypes.js";
import { workspacePathsOverlap } from "../Execution/SeneraWorkspacePath.js";

const ResourceIntentSchema = z.enum(["inspect", "read", "create", "replace", "remove", "execute"]);
const ResourceIntentSelectorSchema = z
  .object({
    Selector: z.string().regex(/^(?:\/(?:[^~/]|~[01])*)+$/u),
    Cases: z
      .array(
        z
          .object({
            Equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            Intent: ResourceIntentSchema,
          })
          .strict(),
      )
      .min(1),
    Default: ResourceIntentSchema,
  })
  .strict()
  .superRefine((selector, context) => {
    const values = new Set<string>();
    selector.Cases.forEach((entry, index) => {
      const identity = JSON.stringify(entry.Equals);
      if (values.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["Cases", index, "Equals"],
          message: "Workspace path intent cases must use unique scalar values.",
        });
      }
      values.add(identity);
    });
  });

const WorkspacePathParametersSchema = z
  .object({
    Intent: z.union([ResourceIntentSchema, ResourceIntentSelectorSchema]),
  })
  .strict();

type WorkspacePathParameters = z.infer<typeof WorkspacePathParametersSchema>;

interface WorkspacePathResourceInput {
  resource: ToolResourceArgumentManifest;
  value: unknown;
  args: Readonly<Record<string, unknown>>;
}

const SharedResourceIntents = new Set<AgentResourceAccessIntent>([
  AgentResourceAccessIntents.Inspect,
  AgentResourceAccessIntents.Read,
]);

export class AgentToolWorkspacePathResourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.WorkspacePath;
  private readonly claimDomain: AgentToolResourceClaimDomain = Object.freeze({
    id: this.id,
    overlaps: workspacePathsOverlap,
  });

  constructor(private readonly executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath">) {}

  async project(input: WorkspacePathResourceInput) {
    const resolved = await this.resolve(input);
    return {
      target: "argument" as const,
      value: resolved.path,
    };
  }

  async claim(input: WorkspacePathResourceInput) {
    const resolved = await this.resolve(input);
    return [
      {
        domain: this.claimDomain,
        identity: resolved.path,
        access: SharedResourceIntents.has(resolved.intent)
          ? AgentToolResourceAccessModes.Shared
          : AgentToolResourceAccessModes.Exclusive,
      },
    ];
  }

  private async resolve(input: WorkspacePathResourceInput): Promise<{
    path: string;
    intent: AgentResourceAccessIntent;
  }> {
    if (typeof input.value !== "string") {
      throw new TypeError(`Workspace resource ${input.resource.Pointer} must be a string.`);
    }
    const parameters = WorkspacePathParametersSchema.parse(input.resource.Parameters ?? {});
    const intent = resolveIntent(parameters, input.args);
    const resolved = await this.executionEnv.resolveResourcePath(input.value, intent);
    if (!resolved.ok) throw resolved.error;
    return {
      path: resolved.value,
      intent,
    };
  }
}

function resolveIntent(
  parameters: WorkspacePathParameters,
  args: Readonly<Record<string, unknown>>,
): AgentResourceAccessIntent {
  if (typeof parameters.Intent === "string") return parameters.Intent;
  const selected = readAgentJsonPointer(args, parameters.Intent.Selector);
  return (
    parameters.Intent.Cases.find((entry) => selected.found && Object.is(entry.Equals, selected.value))?.Intent ??
    parameters.Intent.Default
  );
}
