import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { projectAgentToolInvocationSchema } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { projectAgentToolInteraction } from "../ToolRuntime/AgentToolInteractionProjector.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";

const OutputSummaryMaxChars = 480;
const contracts = new AgentJsonSchemaPromptContractProjector();

/**
 * The outer tool result remains structured, while the contract itself is a
 * TypeScript-like compact text block. Repeating JSON Schema, XML, property
 * lists, and use-case objects after the model has selected a name costs many
 * tokens without adding another execution constraint.
 *
 * [exact tool name, human title, compact contract]
 */
export type AgentToolDescriptionTuple = readonly [name: string, title: string, spec: string];

export function projectToolDescription(
  tool: RegisteredTool,
  runtimeTargets: readonly ToolExecutionTarget[] = tool.execution.Targets,
): AgentToolDescriptionTuple {
  const interaction = projectAgentToolInteraction(tool);
  const declaredContract = tool.contract?.arguments;
  const invocationContract = declaredContract
    ? contracts.project(projectAgentToolInvocationSchema(tool, declaredContract.jsonSchema, runtimeTargets))
    : undefined;

  return [
    tool.name,
    interaction.title,
    projectCompactContract(tool, interaction.purpose, invocationContract?.tsHintLines, runtimeTargets),
  ];
}

function projectCompactContract(
  tool: RegisteredTool,
  purpose: string,
  signatureLines: readonly string[] | undefined,
  runtimeTargets: readonly ToolExecutionTarget[],
): string {
  const args = signatureLines?.join("\n") || "arguments: Record<string, unknown>";
  const permissions = tool.permissions.length > 0 ? `; permissions=${tool.permissions.join("|")}` : "";
  return [
    `use: ${purpose}`,
    `args:\n${args}`,
    `returns: ${summarizeOutputSchema(tool.contract?.outputSchema)}`,
    `boundary: targets=${runtimeTargets.join("|") || "none"}; network=${tool.execution.Network}; workspace=${tool.execution.Workspace}; approval=${tool.approval?.Mode ?? "allow"}${permissions}`,
  ].join("\n");
}

function summarizeOutputSchema(schema: Readonly<Record<string, unknown>> | undefined): string {
  if (!schema) return "unknown";
  const type = typeof schema.type === "string" ? schema.type : "object";
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties).sort() : [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : [],
  );
  const compact =
    properties.length === 0
      ? type
      : `${type}{${properties.map((name) => `${name}${required.has(name) ? "" : "?"}`).join(",")}}`;
  return compact.length <= OutputSummaryMaxChars ? compact : `${compact.slice(0, OutputSummaryMaxChars - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
