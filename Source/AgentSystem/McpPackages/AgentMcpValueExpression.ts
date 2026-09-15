import { AgentBaseError } from "../Core/AgentBaseError.js";
import { stringifyAgentExtensionInputValue } from "../Extensions/AgentExtensionInput.js";
import type {
  AgentExtensionValueExpression,
  AgentExtensionValueExpressionSegment,
  AgentExtensionValueResolver,
} from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentMcpInputDefinition } from "./AgentMcpInputDefinition.js";

export class AgentMcpInputsRequiredError extends AgentBaseError {
  readonly code = "mcp_inputs_required";

  constructor(
    readonly serverId: string,
    readonly inputIds: readonly string[],
  ) {
    super(`MCP server ${serverId} requires inputs: ${inputIds.join(", ")}.`);
  }
}

export interface AgentMcpExpressionRuntimeValues {
  readonly packageRoot: string;
  readonly workspaceRoot?: string;
}

export function resolveAgentMcpValueExpression(
  serverId: string,
  expression: AgentExtensionValueExpression,
  inputs: readonly AgentMcpInputDefinition[],
  resolver: AgentExtensionValueResolver,
  runtime: AgentMcpExpressionRuntimeValues,
  missing: Set<string>,
): string {
  const definitions = new Map(inputs.map((input) => [input.id, input]));
  return expression.segments
    .map((segment) => resolveSegment(serverId, segment, definitions, resolver, runtime, missing))
    .join("");
}

export function assertNoMissingAgentMcpInputs(serverId: string, missing: ReadonlySet<string>): void {
  if (missing.size > 0) throw new AgentMcpInputsRequiredError(serverId, [...missing].sort());
}

function resolveSegment(
  serverId: string,
  segment: AgentExtensionValueExpressionSegment,
  definitions: ReadonlyMap<string, AgentMcpInputDefinition>,
  resolver: AgentExtensionValueResolver,
  runtime: AgentMcpExpressionRuntimeValues,
  missing: Set<string>,
): string {
  if (segment.kind === "literal") return segment.value;
  if (segment.binding.source === "runtime") return runtime[segment.binding.key] ?? "";
  const inputId = "inputId" in segment.binding ? segment.binding.inputId : undefined;
  const definition = inputId ? definitions.get(inputId) : undefined;
  const resolution = resolver.resolve(serverId, segment.binding);
  const value = resolution?.value ?? segment.defaultValue ?? definition?.defaultValue;
  if (value !== undefined) return stringifyAgentExtensionInputValue(value);
  const missingId = inputId ?? ("name" in segment.binding ? segment.binding.name : undefined);
  if (missingId) missing.add(missingId);
  return "";
}
