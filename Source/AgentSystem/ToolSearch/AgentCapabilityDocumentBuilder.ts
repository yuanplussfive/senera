import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { AgentMcpServiceDiscoveryEntry } from "../McpPackages/AgentMcpPackageTypes.js";
import type { ToolSearchCapabilityManifest } from "../Types/AgentToolContractTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { capabilityFacetEntries, capabilitySearchText } from "./AgentToolSearchCapabilities.js";
import type { ToolSearchDocument } from "./AgentToolSearchTypes.js";
import {
  AgentCapabilityKinds,
  type AgentCapabilitySearchDocument,
  type AgentCapabilitySemanticInput,
} from "./AgentCapabilitySearchIndex.js";

export function buildToolCapabilityDocument(
  tool: RegisteredTool,
  document: ToolSearchDocument,
): AgentCapabilitySearchDocument {
  const owner = resolveAgentToolOwner(tool);
  const semanticFields = {
    identity: semanticIdentityText(document),
    title: document.title,
    tags: document.tags,
    facets: document.capabilityFacets,
    summary: document.summary,
    useCases: document.whenToUse,
    examples: document.examples,
    capabilities: document.capabilityText,
    parameters: document.params,
    owner: document.ownerTitle || document.ownerName,
  };
  return {
    id: capabilityDocumentId(AgentCapabilityKinds.Tool, owner.name, tool.name),
    kind: AgentCapabilityKinds.Tool,
    name: tool.name,
    revision: tool.contract?.digest ?? owner.revision,
    title: document.title,
    owner: `${document.ownerName} ${document.ownerTitle}`,
    sourceText: document.sourceText,
    tags: document.tags,
    summary: document.summary,
    useCases: document.whenToUse,
    examples: document.examples,
    capabilityText: document.capabilityText,
    capabilityFacets: document.capabilityFacets,
    parameters: document.params,
    fuzzyText: fuzzyCapabilityText(tool.name, document.title, document.capabilities),
    semanticInputs: semanticCapabilityInputs(semanticFields),
    semanticText: semanticCapabilityText(semanticFields),
  };
}

export function buildMcpServiceCapabilityDocument(
  service: AgentMcpServiceDiscoveryEntry,
): AgentCapabilitySearchDocument {
  const identity = [service.id, service.title, ...service.aliases].join("\n");
  return {
    id: capabilityDocumentId(AgentCapabilityKinds.Service, service.id, service.id),
    kind: AgentCapabilityKinds.Service,
    name: service.id,
    revision: service.revision,
    title: service.title,
    owner: service.id,
    sourceText: service.description,
    tags: service.aliases.join(" "),
    summary: service.description,
    useCases: "",
    examples: "",
    capabilityText: service.description,
    capabilityFacets: "",
    parameters: "",
    fuzzyText: identity,
    semanticInputs: [
      { id: "identity", text: [identity, service.description].join("\n") },
      { id: "intent", text: service.description },
    ],
    semanticText: [identity, service.description].join("\n"),
  };
}

export function buildSkillCapabilityDocument(skill: RegisteredSkill): AgentCapabilitySearchDocument {
  const search = skill.search;
  const capabilities = search?.Capabilities ?? [];
  const capabilityText = capabilities
    .map((capability) => capabilitySearchText(capability, { includeRisk: false }))
    .join(" ");
  const capabilityFacets = capabilities
    .flatMap((capability) => capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values))
    .join(" ");
  const tags = (search?.Tags ?? []).join(" ");
  const summary = search?.Summary ?? skill.description;
  const useCases = (search?.UseCases ?? []).join(" ");
  const examples = (search?.Examples ?? []).join(" ");
  const title = skill.title ?? search?.Summary ?? skill.name;
  const parameters = skill.recommendedTools.join(" ");
  const semanticFields = {
    identity: [skill.name, title, tags, capabilityFacets].filter(Boolean).join(" "),
    title,
    tags,
    facets: capabilityFacets,
    summary,
    useCases,
    examples,
    capabilities: capabilityText,
    parameters,
    owner: skill.source.displayName,
  };
  return {
    id: capabilityDocumentId(AgentCapabilityKinds.Skill, skill.source.id, skill.name),
    kind: AgentCapabilityKinds.Skill,
    name: skill.name,
    revision: skill.revision ?? skill.source.id,
    title,
    owner: skill.source.displayName,
    sourceText: `${skill.source.kind} ${skill.source.id} ${skill.source.displayName}`,
    tags,
    summary,
    useCases,
    examples,
    capabilityText,
    capabilityFacets,
    parameters,
    fuzzyText: fuzzyCapabilityText(skill.name, title, capabilities),
    semanticInputs: semanticCapabilityInputs(semanticFields),
    semanticText: semanticCapabilityText(semanticFields),
  };
}

function fuzzyCapabilityText(
  name: string,
  title: string,
  capabilities: readonly ToolSearchCapabilityManifest[],
): string {
  return [
    name,
    title,
    ...capabilities.flatMap((capability) => [capability.Id, capability.Title, ...(capability.Aliases ?? [])]),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function semanticCapabilityText(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .filter(([, value]) => value.trim().length > 0)
    .map(([name, value]) => `${name}: ${value.trim()}`)
    .join("\n");
}

function semanticCapabilityInputs(fields: Readonly<Record<string, string>>): readonly AgentCapabilitySemanticInput[] {
  const groups = [
    // The primary view is intentionally short, but it must carry the
    // producer's operation description. Names and facets alone cannot bridge
    // a Chinese request to an English-only MCP description, and they would
    // also leave a description-only catalog change invisible to the cache
    // identity. Longer examples and use-case prose stay demand-driven below.
    ["identity", ["identity", "summary", "capabilities"]],
    ["intent", ["title", "summary", "useCases", "examples", "capabilities"]],
    ["contract", ["title", "parameters", "owner"]],
  ] as const;
  return groups
    .map(([id, names]) => ({
      id,
      text: semanticCapabilityText(Object.fromEntries(names.map((name) => [name, fields[name] ?? ""]))),
    }))
    .filter((input) => input.text.length > 0);
}

function semanticIdentityText(document: ToolSearchDocument): string {
  return [
    document.toolName,
    document.title,
    document.identityPhrases.join(" "),
    document.tags,
    document.capabilityFacets,
  ]
    .filter(Boolean)
    .join(" ");
}

function capabilityDocumentId(kind: string, owner: string, name: string): string {
  return sha256HexOfCanonicalJson([kind, owner, name]);
}
