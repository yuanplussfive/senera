import { z } from "zod";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import type { AgentResourceAccessRequest } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolResourceCapability } from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolResourceCapabilityIds } from "./AgentToolResourceCapabilityIds.js";
import {
  parseAgentJsonPointer,
  readAgentJsonPointer,
  readAgentJsonPointerMatches,
  replaceAgentJsonPointer,
} from "../Core/AgentJsonPointerOperations.js";
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

const PathPointerPatternSchema = z
  .string()
  .min(1)
  .refine((pointer) => {
    try {
      return parseAgentJsonPointer(pointer).every((token) => token === "*" || !token.includes("*"));
    } catch {
      return false;
    }
  }, "Path pointer patterns must be valid JSON Pointers with whole-token '*' wildcards.")
  .describe("JSON Pointer pattern relative to the declared value; * selects array entries or object keys.");

const WorkspacePathParametersSchema = z
  .object({
    Intent: z.union([ResourceIntentSchema, ResourceIntentSelectorSchema]),
    PathPointers: z.array(PathPointerPatternSchema).min(1).optional(),
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
  AgentResourceAccessIntents.Execute,
]);

/** Shared overlap domain for path and whole-workspace claims. */
export const AgentWorkspacePathClaimDomain: AgentToolResourceClaimDomain = Object.freeze({
  id: AgentToolResourceCapabilityIds.WorkspacePath,
  overlaps: workspacePathsOverlap,
});

export class AgentToolWorkspacePathResourceCapability implements AgentToolResourceCapability {
  readonly id = AgentToolResourceCapabilityIds.WorkspacePath;
  private readonly claimDomain = AgentWorkspacePathClaimDomain;

  constructor(
    private readonly executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath"> &
      Partial<Pick<SeneraExecutionEnv, "inspectResourcePath">>,
  ) {}

  async project(input: WorkspacePathResourceInput) {
    const parameters = WorkspacePathParametersSchema.parse(input.resource.Parameters ?? {});
    if (!parameters.PathPointers) {
      const resolved = await this.resolveSingle(input, resolveIntent(parameters, input.args), input.value);
      return { target: "argument" as const, value: resolved.path };
    }
    return {
      target: "argument" as const,
      value: await this.projectPathCollection(input, parameters),
    };
  }

  async claim(input: WorkspacePathResourceInput) {
    const parameters = WorkspacePathParametersSchema.parse(input.resource.Parameters ?? {});
    const intent = resolveIntent(parameters, input.args);
    const paths = await this.resolvePaths(input, parameters);
    return paths.map((pathValue) => ({
      domain: this.claimDomain,
      identity: pathValue,
      access: SharedResourceIntents.has(intent)
        ? AgentToolResourceAccessModes.Shared
        : AgentToolResourceAccessModes.Exclusive,
    }));
  }

  async inspect(input: WorkspacePathResourceInput): Promise<readonly AgentResourceAccessRequest[]> {
    const parameters = WorkspacePathParametersSchema.parse(input.resource.Parameters ?? {});
    const intent = resolveIntent(parameters, input.args);
    const paths = await this.resolveInputPaths(input, parameters);
    const executionEnv = this.executionEnv;
    if (!executionEnv.inspectResourcePath) return [];
    const inspectResourcePath = executionEnv.inspectResourcePath.bind(executionEnv);
    return (await Promise.all(paths.map((pathValue) => inspectResourcePath(pathValue, intent)))).filter(
      (request): request is AgentResourceAccessRequest => request !== undefined,
    );
  }

  private async resolveSingle(
    input: WorkspacePathResourceInput,
    intent: AgentResourceAccessIntent,
    value: unknown,
  ): Promise<{ path: string; intent: AgentResourceAccessIntent }> {
    if (typeof value !== "string") {
      throw new TypeError(`Workspace resource ${input.resource.Pointer} must be a string.`);
    }
    const resolved = await this.executionEnv.resolveResourcePath(value, intent);
    if (!resolved.ok) throw resolved.error;
    return { path: resolved.value, intent };
  }

  private async resolvePaths(
    input: WorkspacePathResourceInput,
    parameters: WorkspacePathParameters,
  ): Promise<readonly string[]> {
    const intent = resolveIntent(parameters, input.args);
    const paths = await this.resolveInputPaths(input, parameters);
    return (await Promise.all(paths.map((value) => this.resolveSingle(input, intent, value)))).map(
      (resolved) => resolved.path,
    );
  }

  private async resolveInputPaths(
    input: WorkspacePathResourceInput,
    parameters: WorkspacePathParameters,
  ): Promise<readonly string[]> {
    if (!parameters.PathPointers) {
      if (typeof input.value !== "string") {
        throw new TypeError(`Workspace resource ${input.resource.Pointer} must be a string.`);
      }
      return [input.value];
    }
    const matches = parameters.PathPointers.flatMap((pointer) => readAgentJsonPointerMatches(input.value, pointer));
    if (matches.length === 0) {
      throw new TypeError(`Workspace resource ${input.resource.Pointer} did not select any paths.`);
    }
    return matches.map((match) => {
      if (typeof match.value !== "string") {
        throw new TypeError(`Workspace resource ${input.resource.Pointer}${match.pointer} must be a string.`);
      }
      return match.value;
    });
  }

  private async projectPathCollection(
    input: WorkspacePathResourceInput,
    parameters: WorkspacePathParameters,
  ): Promise<unknown> {
    let projected = input.value;
    const intent = resolveIntent(parameters, input.args);
    for (const pointer of parameters.PathPointers ?? []) {
      for (const match of readAgentJsonPointerMatches(projected, pointer)) {
        const resolved = await this.resolveSingle(input, intent, match.value);
        projected = replaceAgentJsonPointer(projected, match.pointer, resolved.path);
      }
    }
    return projected;
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
