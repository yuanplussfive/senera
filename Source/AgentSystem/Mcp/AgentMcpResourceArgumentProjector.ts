import type { ToolResourceArgumentManifest } from "../Types/PluginToolManifestTypes.js";
import type { AgentMcpResourceCapabilityRegistry } from "./AgentMcpResourceCapabilityRegistry.js";
import { readAgentMcpJsonPointer, replaceAgentMcpJsonPointer } from "./AgentMcpJsonPointer.js";

export async function projectAgentMcpResourceArguments(
  args: Readonly<Record<string, unknown>>,
  resources: readonly ToolResourceArgumentManifest[],
  capabilities: AgentMcpResourceCapabilityRegistry,
): Promise<Record<string, unknown>> {
  let projected: Record<string, unknown> = { ...args };
  const resourceBindings = new Set<string>();
  for (const resource of resources) {
    const value = readAgentMcpJsonPointer(projected, resource.Pointer);
    if (!value.found) continue;
    const result = await capabilities.project(resource, value.value, projected);
    if (result.target === "argument") {
      projected = replaceJsonPointer(projected, resource.Pointer, result.value);
    } else {
      if (resourceBindings.has(result.binding)) {
        throw new Error(`Duplicate MCP resource binding declaration: ${result.binding}`);
      }
      resourceBindings.add(result.binding);
      projected = appendPublicResource(projected, result.binding, result.value);
    }
  }
  return projected;
}

function appendPublicResource(args: Record<string, unknown>, binding: string, value: unknown): Record<string, unknown> {
  const resources = readPublicResources(args.resources);
  return {
    ...args,
    resources: {
      ...resources,
      [binding]: value,
    },
  };
}

export type AgentMcpResourceProjection =
  | {
      target: "argument";
      value: unknown;
    }
  | {
      target: "resource";
      binding: string;
      value: unknown;
    };

function replaceJsonPointer(value: unknown, pointer: string, replacement: unknown): Record<string, unknown> {
  const result = replaceAgentMcpJsonPointer(value, pointer, replacement);
  return readRecord(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("MCP tool arguments must be an object.");
  return value;
}

function readPublicResources(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (isRecord(value)) return value;
  throw new TypeError("MCP tool resources must be an object.");
}
