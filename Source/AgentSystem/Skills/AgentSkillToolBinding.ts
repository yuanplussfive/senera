import fs from "node:fs";
import { z } from "zod";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentExtensionDiagnostic } from "../ManagedExtensions/AgentExtensionDiagnostic.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import { agentSkillFrontmatterDiagnostic } from "./AgentSkillFrontmatterDiagnostics.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";
import { AgentSkillValidationError } from "./AgentSkillValidationError.js";

export const AgentSkillRecommendedToolsPath = ["metadata", "senera", "recommended-tools"] as const;

export interface AgentSkillToolReferenceValidationOptions {
  readonly isDeferredToolReference?: (toolName: string) => boolean;
}

export const AgentSkillRecommendedToolsSchema = z.array(z.string().trim().min(1)).superRefine((toolNames, context) => {
  const firstIndex = new Map<string, number>();
  toolNames.forEach((toolName, index) => {
    const previous = firstIndex.get(toolName);
    if (previous === undefined) {
      firstIndex.set(toolName, index);
      return;
    }
    context.addIssue({
      code: "custom",
      path: [index],
      message: `Tool ${toolName} is already declared at index ${previous}.`,
    });
  });
});

export const AgentSkillMetadataSchema = z
  .object({
    senera: z
      .object({
        "recommended-tools": AgentSkillRecommendedToolsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .passthrough();

export function agentSkillRecommendedTools(metadata: z.output<typeof AgentSkillMetadataSchema> | undefined): string[] {
  return [...(metadata?.senera?.["recommended-tools"] ?? [])];
}

export function withAgentSkillRecommendedTools(
  frontmatter: Readonly<Record<string, unknown>>,
  toolNames: readonly string[],
): Record<string, unknown> {
  const recommendedTools = AgentSkillRecommendedToolsSchema.parse(toolNames);
  const parsed = z.object({ metadata: AgentSkillMetadataSchema.optional() }).passthrough().parse(frontmatter);
  const metadata = { ...(parsed.metadata ?? {}) };
  if (recommendedTools.length > 0) {
    metadata.senera = { "recommended-tools": recommendedTools };
  } else {
    delete metadata.senera;
  }
  if (Object.keys(metadata).length > 0) return { ...parsed, metadata };
  const { metadata: _metadata, ...withoutMetadata } = parsed;
  return withoutMetadata;
}

export function agentSkillToolReferenceDiagnostics(
  skill: RegisteredSkill,
  registry: AgentExtensionRegistryLike,
  options: AgentSkillToolReferenceValidationOptions = {},
): AgentExtensionDiagnostic[] {
  if (skill.recommendedTools.length === 0) return [];
  const source = fs.readFileSync(skill.descriptionFile, "utf8");
  return skill.recommendedTools.flatMap((toolName, index) => {
    if (registry.getTool(toolName) || options.isDeferredToolReference?.(toolName)) return [];
    const message = agentErrorMessage("extension.skillRecommendedToolMissing", {
      member: `Skill "${skill.name}" in ${skill.source.kind} source "${skill.source.id}"`,
      toolName,
    });
    return [
      agentSkillFrontmatterDiagnostic(
        source,
        skill.descriptionFile,
        [...AgentSkillRecommendedToolsPath, index],
        message,
        "skill.metadata.senera.recommendedToolMissing",
      ),
    ];
  });
}

export function assertAgentSkillToolReferences(skill: RegisteredSkill, registry: AgentExtensionRegistryLike): void {
  assertAgentSkillCatalogToolReferences([skill], registry);
}

export function assertAgentSkillCatalogToolReferences(
  skills: readonly RegisteredSkill[],
  registry: AgentExtensionRegistryLike,
  options: AgentSkillToolReferenceValidationOptions = {},
): void {
  const diagnostics = skills.flatMap((skill) => agentSkillToolReferenceDiagnostics(skill, registry, options));
  if (diagnostics.length === 0) return;
  throw new AgentSkillValidationError(
    [
      agentErrorMessage("extension.referenceValidationFailed"),
      ...diagnostics.map(({ message }) => `- ${message}`),
    ].join("\n"),
    diagnostics,
  );
}
