import { ToolSchedulingModes, type ToolSchedulingMode } from "../Types/AgentToolContractTypes.js";
import type { AgentMcpToolDeclaration } from "./AgentMcpToolCatalogChange.js";
import { AgentToolContentPolicySchema } from "../Schemas/AgentToolContentPolicySchema.js";
import type { AgentToolContentPolicy } from "../Types/AgentToolContentPolicyTypes.js";

/** Namespaced MCP metadata understood by Senera's generic tool runtime. */
export const AgentMcpToolRuntimeMetadataKey = "ai.senera/runtime";
/** Optional package-owned result representation and host projection contract. */
export const AgentMcpToolContentPolicyMetadataKey = "ai.senera/content-policy";

const SchedulingByWireValue = {
  parallel: ToolSchedulingModes.Parallel,
  "resource-claims": ToolSchedulingModes.ResourceClaims,
} as const satisfies Readonly<Record<string, ToolSchedulingMode>>;

const DefaultScheduling = ToolSchedulingModes.Parallel;

export interface AgentMcpToolRuntimeProjection {
  readonly scheduling: ToolSchedulingMode;
  readonly maxConcurrency?: number;
  readonly contentPolicy?: AgentToolContentPolicy;
}

/**
 * Projects an MCP tool's opt-in runtime policy.
 *
 * MCP tools run in the normal bounded parallel scheduler by default. A server
 * may opt a tool into resource claims or declare a lower tool-level limit
 * without relying on its package or tool name.
 */
export function projectAgentMcpToolRuntime(declaration: AgentMcpToolDeclaration): AgentMcpToolRuntimeProjection {
  const raw = declaration._meta?.[AgentMcpToolRuntimeMetadataKey];
  const contentPolicy = projectContentPolicy(
    declaration.name,
    declaration._meta?.[AgentMcpToolContentPolicyMetadataKey],
  );
  if (raw === undefined) {
    return {
      scheduling: DefaultScheduling,
      ...(contentPolicy === undefined ? {} : { contentPolicy }),
    };
  }
  if (!isRecord(raw)) {
    throw new TypeError(`MCP tool ${declaration.name} metadata ${AgentMcpToolRuntimeMetadataKey} must be an object.`);
  }

  const scheduling = projectScheduling(declaration.name, raw.scheduling);
  const maxConcurrency = projectMaxConcurrency(declaration.name, raw.maxConcurrency);
  return {
    scheduling,
    ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
    ...(contentPolicy === undefined ? {} : { contentPolicy }),
  };
}

function projectScheduling(toolName: string, value: unknown): ToolSchedulingMode {
  if (value === undefined) return DefaultScheduling;
  if (typeof value !== "string" || !Object.hasOwn(SchedulingByWireValue, value)) {
    throw new TypeError(
      `MCP tool ${toolName} metadata ${AgentMcpToolRuntimeMetadataKey}.scheduling must be parallel or resource-claims.`,
    );
  }
  return SchedulingByWireValue[value as keyof typeof SchedulingByWireValue];
}

function projectMaxConcurrency(toolName: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000) {
    throw new TypeError(
      `MCP tool ${toolName} metadata ${AgentMcpToolRuntimeMetadataKey}.maxConcurrency must be an integer from 1 to 1000.`,
    );
  }
  return value as number;
}

function projectContentPolicy(toolName: string, value: unknown): AgentToolContentPolicy | undefined {
  if (value === undefined) return undefined;
  const parsed = AgentToolContentPolicySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new TypeError(
    `MCP tool ${toolName} metadata ${AgentMcpToolContentPolicyMetadataKey} is invalid: ${parsed.error.message}`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
