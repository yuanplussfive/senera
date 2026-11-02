import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentMemoryEpisodeRecord, AgentMemoryRecordedTurn } from "../Memory/AgentMemorySourceRepository.js";
import { AgentModelTextPreviewer } from "../Text/AgentTextBudget.js";
import { AgentStateCardSchema, AgentStateCardSchemaVersion } from "../StateCard/AgentStateCardTypes.js";

export const AgentMemOSFragmentCommitSchema = z
  .object({
    nodeIds: z.array(z.string().min(1)),
    /** Absent only in commits produced before mandatory task utility assessment. */
    assessmentVersion: z.number().int().positive().optional(),
  })
  .strict();
export const AgentMemOSDeleteRequestSchema = z
  .object({ episodeUris: z.array(z.string()), sourceUris: z.array(z.string()) })
  .strict();
export const MaximumTimerDelayMs = 2_147_000_000;

const MemoryIntentEvidenceSchema = z.object({
  kind: z.literal("continuity_write"),
  facts: z.array(z.object({ name: z.string(), value: z.string() })),
});

export function projectMemoryIntents(turn: AgentMemoryRecordedTurn): string[] {
  return unique(
    turn.sources.flatMap((source) => {
      const value = source.metadata.evidence;
      if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "continuity_write") return [];
      const evidence = MemoryIntentEvidenceSchema.parse(value);
      return evidence.facts.filter((fact) => fact.name === "summary").map((fact) => fact.value);
    }),
  );
}

export function projectStateCard(value: unknown) {
  if (value === undefined) return undefined;
  const { version } = z.object({ version: z.string() }).parse(value);
  // Retired producer contracts are not parsed, rewritten, or re-learned.
  if (version !== AgentStateCardSchemaVersion) return undefined;
  return AgentStateCardSchema.parse(value);
}

export function previewForModel(text: string, model: string, tokenLimit: number): string {
  return new AgentModelTextPreviewer({ model, tokenLimit, ellipsis: "..." }).preview(text).text;
}

export function fragmentSourceRevision(episode: AgentMemoryEpisodeRecord): string {
  return sha256HexOfCanonicalJson({
    uri: episode.uri,
    updatedAt: episode.updatedAt,
    standaloneRequest: episode.standaloneRequest,
    user: episode.rawUserText,
    assistant: episode.assistantText,
    stateCard: episode.metadata.stateCard,
  });
}

export function fragmentTaskKey(episode: AgentMemoryEpisodeRecord): string {
  return `fragment:${episode.uri}:${episode.updatedAt}`;
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function validateConfig<T extends object>(config: T): void {
  for (const [name, value] of Object.entries(config) as [string, unknown][]) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
      throw new Error(`MemOS semantic ${name} must be a positive integer.`);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
