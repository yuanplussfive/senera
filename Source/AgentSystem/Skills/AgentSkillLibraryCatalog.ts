import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentSkillCatalogProjector } from "./AgentSkillCatalogProjector.js";
import { agentSkillLogicalUri } from "./AgentSkillResourceUri.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";

export const AgentSkillLibraryProtocol = "senera.skill-library/v1" as const;

export type AgentSkillLibraryLoadMode = "on-demand";
export type AgentSkillLibraryInvocationState = "available" | "explicit-only";

const MaxDirectoryTextCharacters = 256;
const MaxDirectoryValues = 8;

export interface AgentSkillLibraryEntry {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly scope: RegisteredSkill["source"]["kind"];
  readonly state: AgentSkillLibraryInvocationState;
  readonly revision: string;
  readonly entry: string;
  readonly load: AgentSkillLibraryLoadMode;
  readonly tags: readonly string[];
  readonly useCases: readonly string[];
  readonly capabilities: readonly string[];
}

export interface AgentSkillLibraryCatalog {
  readonly protocol: typeof AgentSkillLibraryProtocol;
  readonly revision: string;
  readonly entries: readonly AgentSkillLibraryEntry[];
}

/**
 * Projects the registered Skill catalog into the small model-facing directory.
 * The projection deliberately excludes host paths and Skill bodies. The
 * registry and the existing catalog projector remain the only metadata
 * authorities; this view only adds the logical package entry URI and bounded
 * directory semantics.
 */
export function projectAgentSkillLibraryCatalog(registry: AgentExtensionRegistry): AgentSkillLibraryCatalog {
  const projector = new AgentSkillCatalogProjector(registry);
  const entries = registry
    .listSkills()
    .map((skill) => projectEntry(skill, projector.project(skill)))
    .sort(compareEntries);
  return {
    protocol: AgentSkillLibraryProtocol,
    revision: sha256HexOfCanonicalJson(entries),
    entries,
  };
}

function projectEntry(
  skill: RegisteredSkill,
  catalog: ReturnType<AgentSkillCatalogProjector["project"]>,
): AgentSkillLibraryEntry {
  return {
    name: skill.name,
    title: compactText(catalog.title, skill.name),
    summary: compactText(catalog.summary, skill.description),
    scope: skill.source.kind,
    state: skill.disableModelInvocation === true ? "explicit-only" : "available",
    revision: skill.revision ?? skill.source.id,
    entry: agentSkillLogicalUri(skill.name),
    load: "on-demand",
    tags: boundedStrings(catalog.tags),
    useCases: boundedStrings(catalog.useCases),
    capabilities: boundedStrings(catalog.capabilities.map((capability) => capability.id)),
  };
}

function compareEntries(left: AgentSkillLibraryEntry, right: AgentSkillLibraryEntry): number {
  return compareStableText(left.name, right.name) || compareStableText(left.revision, right.revision);
}

function boundedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => compactText(value)).filter(Boolean))]
    .sort(compareStableText)
    .slice(0, MaxDirectoryValues);
}

function compactText(value: string | undefined, fallback = ""): string {
  const normalized = (value ?? fallback).replace(/\s+/gu, " ").trim();
  return normalized.length > MaxDirectoryTextCharacters
    ? `${normalized.slice(0, MaxDirectoryTextCharacters - 3).trimEnd()}...`
    : normalized;
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
