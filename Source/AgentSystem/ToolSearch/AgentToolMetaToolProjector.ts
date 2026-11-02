import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  projectAgentToolInvocationSchema,
  resolveAvailableAgentToolExecutionTargets,
} from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { projectAgentToolInteraction } from "../ToolRuntime/AgentToolInteractionProjector.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { renderAgentToolResultType } from "../ToolContracts/AgentToolScriptContract.js";

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
  const targets = resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets);
  const declaredContract = tool.contract?.arguments;
  const invocationContract = declaredContract
    ? contracts.project(projectAgentToolInvocationSchema(tool, declaredContract.jsonSchema, targets))
    : undefined;

  return [
    tool.name,
    interaction.title,
    projectCompactContract(tool, interaction.purpose, invocationContract?.tsHintLines, targets),
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
    `use: ${tool.description ?? purpose}`,
    `args:\n${args}`,
    `returns: ${renderAgentToolResultType(tool.contract?.outputSchema)}`,
    `boundary: targets=${runtimeTargets.join("|") || "none"}; network=${tool.execution.Network}; workspace=${tool.execution.Workspace}; approval=${tool.approval?.Mode ?? "allow"}${permissions}`,
  ].join("\n");
}
