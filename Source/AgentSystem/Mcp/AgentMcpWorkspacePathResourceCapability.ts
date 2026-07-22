import { z } from "zod";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest } from "../Types/PluginToolManifestTypes.js";
import type { AgentMcpResourceCapability } from "./AgentMcpResourceCapabilityRegistry.js";
import { AgentMcpResourceCapabilityIds } from "./AgentMcpResourceCapabilityIds.js";
import { readAgentMcpJsonPointer } from "./AgentMcpJsonPointer.js";

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

export class AgentMcpWorkspacePathResourceCapability implements AgentMcpResourceCapability {
  readonly id = AgentMcpResourceCapabilityIds.WorkspacePath;

  constructor(private readonly executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath">) {}

  async project(input: {
    resource: ToolResourceArgumentManifest;
    value: unknown;
    args: Readonly<Record<string, unknown>>;
  }) {
    if (typeof input.value !== "string") {
      throw new TypeError(`MCP workspace resource ${input.resource.Pointer} must be a string.`);
    }
    const parameters = WorkspacePathParametersSchema.parse(input.resource.Parameters ?? {});
    const resolved = await this.executionEnv.resolveResourcePath(input.value, resolveIntent(parameters, input.args));
    if (!resolved.ok) throw resolved.error;
    return {
      target: "argument" as const,
      value: resolved.value,
    };
  }
}

function resolveIntent(
  parameters: WorkspacePathParameters,
  args: Readonly<Record<string, unknown>>,
): AgentResourceAccessIntent {
  if (typeof parameters.Intent === "string") return parameters.Intent;
  const selected = readAgentMcpJsonPointer(args, parameters.Intent.Selector);
  return (
    parameters.Intent.Cases.find((entry) => selected.found && Object.is(entry.Equals, selected.value))?.Intent ??
    parameters.Intent.Default
  );
}
