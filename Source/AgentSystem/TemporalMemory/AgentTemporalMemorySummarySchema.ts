import { z } from "zod";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { normalizeAgentIdentityTemplate } from "../Prompt/AgentIdentityTemplate.js";
import type { AgentTemporalMemorySummaryResult } from "./AgentTemporalMemoryTypes.js";

const NonEmptyText = z.string().trim().min(1);
const TemporalMemorySummarySchema = z
  .object({
    summary: NonEmptyText,
    topics: z.array(NonEmptyText),
    openLoops: z.array(NonEmptyText),
  })
  .strict();

export function parseAgentTemporalMemorySummary(value: unknown): AgentTemporalMemorySummaryResult {
  const parsed = parseNormalizedBamlOutput(TemporalMemorySummarySchema, value);
  return {
    summary: normalizeTemplateText(parsed.summary),
    topics: uniqueText(parsed.topics),
    openLoops: uniqueText(parsed.openLoops),
  };
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeTemplateText(value: string): string {
  return normalizeAgentIdentityTemplate(normalizeText(value));
}

function uniqueText(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeTemplateText(value);
    const key = normalized.normalize("NFKC").toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}
