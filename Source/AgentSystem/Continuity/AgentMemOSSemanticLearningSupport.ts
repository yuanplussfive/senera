import type { MemoryNode } from "@mem-os/sdk";
import { z } from "zod";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentMemoryEpisodeRecord, AgentMemoryRecordedTurn } from "../Memory/AgentMemorySourceRepository.js";
import { DefaultAgentTimeZone, projectAgentTime } from "../Time/AgentTime.js";
import { AgentModelTextPreviewer, AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import { AgentStateCardSchema, AgentStateCardSchemaVersion } from "../StateCard/AgentStateCardTypes.js";
import type { AgentMemOSDigestEntry } from "./AgentMemOSSemanticTypes.js";
import { AgentMemOSSummarySchema, projectAgentMemOSOccurredAt } from "./AgentMemOSSemanticTypes.js";

export const AgentMemOSFragmentCommitSchema = z.object({ nodeIds: z.array(z.string().min(1)) }).strict();
export const AgentMemOSDeleteRequestSchema = z
  .object({ episodeUris: z.array(z.string()), sourceUris: z.array(z.string()) })
  .strict();
export const MaximumTimerDelayMs = 2_147_000_000;

export function readNodeIds(metadata: Readonly<Record<string, unknown>>): string[] {
  // Pending or failed commits may not have written any node IDs yet.
  return AgentMemOSFragmentCommitSchema.partial().parse(metadata).nodeIds ?? [];
}

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

export function completedDate(episode: AgentMemoryEpisodeRecord): string {
  return projectAgentTime(episode.completedAt, DefaultAgentTimeZone).localDate;
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

export function projectDigestEntry(node: MemoryNode): AgentMemOSDigestEntry {
  return {
    summary: AgentMemOSSummarySchema.parse(node.summary),
    type: node.type,
    occurredAt: projectAgentMemOSOccurredAt(node),
  };
}

export function splitByTokenBudget(
  entries: readonly AgentMemOSDigestEntry[],
  tokenBudget: number,
  model: string,
): AgentMemOSDigestEntry[][] {
  const estimator = new AgentModelTokenEstimator({ model });
  const chunks: AgentMemOSDigestEntry[][] = [];
  let current: AgentMemOSDigestEntry[] = [];
  for (const entry of entries) {
    const candidate = [...current, entry];
    const tokens = estimator.estimate(JSON.stringify({ entries: candidate })).tokenCount;
    if (current.length === 0 && tokens > tokenBudget)
      throw new Error("A MemOS digest entry exceeds the configured token budget.");
    if (tokens > tokenBudget && current.length > 0) {
      chunks.push(current);
      current = [entry];
      if (estimator.estimate(JSON.stringify({ entries: current })).tokenCount > tokenBudget) {
        throw new Error("A MemOS digest entry exceeds the configured token budget.");
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
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

export function digestSourceRevision(
  entries: readonly AgentMemOSDigestEntry[],
  context: {
    readonly summaryTokenLimit: number;
    readonly providerId: string;
    readonly model: string;
  },
): string {
  return sha256HexOfCanonicalJson({ entries, context });
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function firstEntry(
  chunks: readonly (readonly AgentMemOSDigestEntry[])[],
  index: number,
): AgentMemOSDigestEntry {
  const entry = chunks[index]?.[0];
  if (!entry) throw new Error(`MemOS digest batch ${index} is empty.`);
  return entry;
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
