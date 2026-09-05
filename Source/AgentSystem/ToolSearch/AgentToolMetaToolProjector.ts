import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { projectAgentToolInvocationSchema } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { projectAgentToolInteraction } from "../ToolRuntime/AgentToolInteractionProjector.js";

const OutputSummaryMaxChars = 1_200;
const contracts = new AgentJsonSchemaPromptContractProjector();

export function projectToolDescription(
  tool: RegisteredTool,
  runtimeTargets: readonly ToolExecutionTarget[] = tool.execution.Targets,
): Record<string, unknown> {
  const owner = resolveAgentToolOwner(tool);
  const declaredContract = tool.contract?.arguments;
  const invocationContract = declaredContract
    ? contracts.project(projectAgentToolInvocationSchema(tool, declaredContract.jsonSchema, runtimeTargets))
    : undefined;
  const interaction = projectAgentToolInteraction(tool);
  return {
    name: tool.name,
    title: interaction.title,
    summary: interaction.purpose,
    loading: tool.loading,
    usage: {
      purpose: interaction.purpose,
      useCases: { item: interaction.useCases },
      examples: { item: interaction.examples },
      avoid: { item: interaction.avoid },
      tags: { item: tool.search?.Tags ?? [] },
    },
    capabilities: {
      item: interaction.capabilities.map((capability) => ({
        id: capability.id,
        title: capability.title,
        description: capability.description,
        aliases: { item: capability.aliases },
      })),
    },
    contract: {
      typescript: {
        lines: { item: invocationContract?.tsHintLines ?? [] },
      },
      xml: invocationContract?.xmlPreview ?? "",
      requiredInputs: {
        item:
          invocationContract?.properties
            .filter((property) => property.required)
            .map((property) => ({ name: property.name, type: property.typeText, description: property.comment })) ?? [],
      },
      optionalInputs: {
        item:
          invocationContract?.properties
            .filter((property) => !property.required)
            .map((property) => ({ name: property.name, type: property.typeText, description: property.comment })) ?? [],
      },
      output: summarizeOutputSchema(tool.contract?.outputSchema),
    },
    effects: {
      executionTargets: { item: tool.execution.Targets },
      network: tool.execution.Network,
      workspace: tool.execution.Workspace,
      permissions: { item: tool.permissions },
      approval: tool.approval?.Mode ?? "allow",
    },
    source: {
      origin: owner.kind,
      id: owner.name,
      revision: owner.revision,
      items: {
        item: tool.sources.map((source) => ({ id: source.Id, title: source.Title })),
      },
    },
  };
}

function summarizeOutputSchema(schema: Readonly<Record<string, unknown>> | undefined): string {
  if (!schema) return "Unspecified result object.";
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties).sort() : [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  const summary = JSON.stringify({ type: schema.type ?? "object", required, properties });
  return summary.length <= OutputSummaryMaxChars ? summary : `${summary.slice(0, OutputSummaryMaxChars - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
