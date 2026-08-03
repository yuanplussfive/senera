import type { ToolResourceArgumentManifest } from "../Types/AgentToolContractTypes.js";
import { readAgentJsonPointer, replaceAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";
import { isAgentUnknownRecord as isRecord, readAgentRecordOrThrow } from "../Core/AgentUnknownValue.js";
import type { AgentToolResourceCapabilityRegistry } from "./AgentToolResourceCapabilityRegistry.js";

export async function projectAgentToolResourceArguments(
  args: Readonly<Record<string, unknown>>,
  resources: readonly ToolResourceArgumentManifest[],
  capabilities: AgentToolResourceCapabilityRegistry,
): Promise<Record<string, unknown>> {
  let projected: Record<string, unknown> = { ...args };
  const resourceBindings = new Set<string>();
  for (const resource of resources) {
    const value = readAgentJsonPointer(projected, resource.Pointer);
    if (!value.found) continue;
    const result = await capabilities.project(resource, value.value, projected);
    if (result.target === "argument") {
      projected = replaceJsonPointer(projected, resource.Pointer, result.value);
    } else {
      if (resourceBindings.has(result.binding)) {
        throw new Error(`Duplicate tool resource binding declaration: ${result.binding}`);
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

export type AgentToolResourceProjection =
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
  const result = replaceAgentJsonPointer(value, pointer, replacement);
  return readAgentRecordOrThrow(result, "Tool arguments");
}

function readPublicResources(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (isRecord(value)) return value;
  throw new TypeError("Tool resources must be an object.");
}
