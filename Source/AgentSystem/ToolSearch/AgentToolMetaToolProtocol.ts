import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentToolAvailabilitySchema } from "../ToolRuntime/AgentToolAvailability.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolMetaToolName } from "./AgentToolSearchRuntimeTypes.js";

export const AgentToolDiscoveryProtocol = defineSeneraProtocol("tool_discovery", 5);
export const AgentToolDescriptionProtocol = defineSeneraProtocol("tool_description", 2);

export const AgentToolCatalogStatuses = {
  Current: "current",
  Stale: "stale",
} as const;

export type AgentToolCatalogStatus = (typeof AgentToolCatalogStatuses)[keyof typeof AgentToolCatalogStatuses];

export const ToolSearchArgumentsSchema = z
  .object({
    query: z.preprocess(coerceStringLike, z.string().trim().min(1)),
  })
  .strict();

export interface ToolSearchArguments {
  readonly query: string;
}

export type ResolvedToolSearchArguments = z.output<typeof ToolSearchArgumentsSchema>;

const ToolMutationArgumentsSchema = z
  .object({
    tools: z.array(z.string().trim().min(1)).min(1).max(12),
    catalogRevision: z.string().trim().min(1).optional(),
  })
  .strict();

export const ToolDescribeArgumentsSchema = z
  .object({ tools: z.array(z.string().trim().min(1)).min(1).max(12) })
  .strict();
export const ToolLoadArgumentsSchema = ToolMutationArgumentsSchema;
export const ToolUnloadArgumentsSchema = ToolMutationArgumentsSchema;

export type ToolDescribeArguments = z.infer<typeof ToolDescribeArgumentsSchema>;
export type ToolLoadArguments = z.infer<typeof ToolLoadArgumentsSchema>;
export type ToolUnloadArguments = z.infer<typeof ToolUnloadArgumentsSchema>;

const AgentToolDescriptionTupleSchema = z.tuple([z.string(), z.string(), z.string()]);
const AgentToolNameCollectionSchema = z.object({ item: z.array(z.string()) }).strict();

/**
 * Wire contract returned by ToolDescribe. The extension manifest is generated
 * from this schema so its versioned protocol identity cannot diverge from the
 * host handler that constructs the result.
 */
export const AgentToolDescriptionOutputSchema = z
  .object({
    type: z.literal(AgentToolDescriptionProtocol.type),
    tools: z.array(AgentToolDescriptionTupleSchema),
    availability: z.record(z.string(), AgentToolAvailabilitySchema).optional(),
    direct: z.array(z.string()).optional(),
    rejected: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Shared wire contract for ToolLoad and ToolUnload, including their stale
 * catalog response. A mutation may include only the collections relevant to
 * the requested operation, while every response retains the catalog identity
 * and current session exposure.
 */
export const AgentToolCatalogMutationOutputSchema = z
  .object({
    type: z.literal(AgentToolDiscoveryProtocol.type),
    catalogStatus: z.enum([AgentToolCatalogStatuses.Current, AgentToolCatalogStatuses.Stale]),
    catalogRevision: z.string(),
    generation: z.number(),
    loaded: AgentToolNameCollectionSchema,
    availability: z.record(z.string(), AgentToolAvailabilitySchema).optional(),
    added: AgentToolNameCollectionSchema.optional(),
    removed: AgentToolNameCollectionSchema.optional(),
    protected: AgentToolNameCollectionSchema.optional(),
    rejected: AgentToolNameCollectionSchema.optional(),
    requested: AgentToolNameCollectionSchema.optional(),
    requestedCatalogRevision: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

export function createAgentToolDescriptionResult(fields: Record<string, unknown>) {
  return AgentToolDescriptionOutputSchema.parse({ ...fields, type: AgentToolDescriptionProtocol.type });
}

export function createAgentToolCatalogMutationResult(fields: Record<string, unknown>) {
  return AgentToolCatalogMutationOutputSchema.parse({ ...fields, type: AgentToolDiscoveryProtocol.type });
}

export function invalidToolMetaArgumentsResult(
  toolName: AgentToolMetaToolName,
  issues: readonly z.ZodIssue[],
): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.InvalidToolArguments,
    message: `${toolName} 参数无效。`,
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      issues,
      toolName,
    },
    diagnostics: issues.map((issue) => ({
      message: issue.message,
      pointer: `/${issue.path.join("/")}`,
      path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
    })),
  });
}

export function okToolMetaResult(result: unknown): AgentToolProcessRunResult {
  return toolProcessSuccessResult(result);
}

function coerceStringLike(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
}
