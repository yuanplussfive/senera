import type { AgentExtensionOwner } from "../Types/AgentExtensionRuntimeTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ToolSearchCapabilityManifest, ToolSearchManifest } from "../Types/AgentToolSearchContractTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";

export interface AgentToolInteractionProjection {
  readonly title: string;
  readonly purpose: string;
  readonly capabilities: readonly AgentToolInteractionCapability[];
  readonly useCases: readonly string[];
  readonly examples: readonly string[];
  readonly avoid: readonly string[];
}

export interface AgentToolInteractionCapability {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly aliases: readonly string[];
}

export interface AgentToolInteractionSource {
  readonly name: string;
  readonly owner: AgentExtensionOwner;
  readonly search?: ToolSearchManifest;
}

export function projectAgentToolInteraction(tool: RegisteredTool): AgentToolInteractionProjection {
  return projectAgentToolInteractionSource({
    name: tool.name,
    owner: resolveAgentToolOwner(tool),
    search: tool.search,
  });
}

export function projectAgentToolInteractionSource(source: AgentToolInteractionSource): AgentToolInteractionProjection {
  const search = source.search;
  const capabilities = (search?.Capabilities ?? []).map(projectCapability);
  const purpose = firstMeaningful([
    search?.Summary,
    ...capabilities.map((capability) => capability.description),
    source.owner.description,
    source.name,
  ]);

  return {
    title: firstMeaningful([capabilities[0]?.title, search?.Summary, source.owner.title, source.name]),
    purpose,
    capabilities,
    useCases: meaningfulList(search?.UseCases),
    examples: meaningfulList(search?.Examples),
    avoid: meaningfulList(search?.Avoid),
  };
}

export function projectAgentToolDescription(tool: RegisteredTool, baseDescription: string): string {
  const interaction = projectAgentToolInteraction(tool);
  const sections = [baseDescription.trim() || interaction.purpose];

  if (interaction.useCases.length > 0) {
    sections.push(`适用场景：${interaction.useCases.join("；")}`);
  }
  if (interaction.avoid.length > 0) {
    sections.push(`不适用：${interaction.avoid.join("；")}`);
  }
  return sections.filter((section) => section.length > 0).join("\n\n");
}

function projectCapability(capability: ToolSearchCapabilityManifest): AgentToolInteractionCapability {
  return {
    id: capability.Id,
    title: firstMeaningful([capability.Title, capability.Id]),
    description: meaningfulText(capability.Description),
    aliases: meaningfulList(capability.Aliases),
  };
}

function meaningfulList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map(meaningfulText).filter((value): value is string => value !== undefined);
}

function meaningfulText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function firstMeaningful(values: readonly (string | undefined)[]): string {
  const value = values.map(meaningfulText).find((item): item is string => item !== undefined);
  if (!value) throw new Error("Tool interaction projection requires a semantic description.");
  return value;
}
