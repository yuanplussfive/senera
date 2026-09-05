import { z } from "zod";
import {
  AgentPersonaPresetSchemaVersion,
  type AgentParsedPresetDocument,
  type AgentPersonaPreset,
  type AgentPresetFileRecord,
} from "./AgentPresetTypes.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const NonEmptyText = z.string().trim().min(1);

const AgentPresetExampleSchema = z
  .object({
    id: NonEmptyText,
    situation: NonEmptyText,
    reply: NonEmptyText,
  })
  .strict();

const AgentPresetLoreEntrySchema = z
  .object({
    id: NonEmptyText,
    title: NonEmptyText,
    keywords: z.array(NonEmptyText),
    content: NonEmptyText,
    enabled: z.boolean(),
  })
  .strict();

const WorldPackageIdsSchema = z.array(NonEmptyText).superRefine((ids, context) => {
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      context.addIssue({ code: "custom", path: [index], message: `Duplicate world package id: ${id}` });
    }
    seen.add(id);
  }
});

export const AgentPersonaPresetSchema = z
  .object({
    schemaVersion: z.literal(AgentPersonaPresetSchemaVersion),
    title: NonEmptyText,
    corePersona: z.string(),
    languageStyle: z.string(),
    worldPackageIds: WorldPackageIdsSchema,
    examples: z.array(AgentPresetExampleSchema),
    lore: z.array(AgentPresetLoreEntrySchema),
  })
  .strict();

const AgentPersonaPresetV1Schema = z
  .object({
    schemaVersion: z.literal("senera.persona/v1"),
    title: NonEmptyText,
    corePersona: z.string(),
    languageStyle: z.string(),
    examples: z.array(AgentPresetExampleSchema),
    lore: z.array(AgentPresetLoreEntrySchema),
  })
  .strict();

export class AgentPresetParser {
  parse(record: AgentPresetFileRecord): AgentParsedPresetDocument {
    return {
      ...record,
      card: this.parseCard(parseJsonText(record.content, "Preset card")),
    };
  }

  parseCard(value: unknown): AgentPersonaPreset {
    const parsed = AgentPersonaPresetSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    const versionOne = AgentPersonaPresetV1Schema.safeParse(value);
    if (versionOne.success) {
      return {
        ...versionOne.data,
        schemaVersion: AgentPersonaPresetSchemaVersion,
        worldPackageIds: [],
      };
    }
    throw new Error(`预设人格卡无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`);
  }
}
