import { z } from "zod";
import { parseNormalizedBamlOutput } from "../BamlClient/AgentBamlOutputNormalizer.js";
import {
  AgentIdentityRoles,
  createAgentTextParts,
  normalizeAgentTextValue,
  type AgentTextParts,
} from "../Text/AgentTextParts.js";
import type { AgentTemporalMemorySummaryResult } from "./AgentTemporalMemoryTypes.js";

const NonEmptyText = z.string().trim().min(1);
const StructuredTextPart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: NonEmptyText }).strict(),
  z.object({ kind: z.literal("identity"), role: z.enum(AgentIdentityRoles) }).strict(),
]);
const TextValue = z.union([NonEmptyText, z.array(StructuredTextPart).min(1)]);
const SectionValue = z.union([TextValue, z.object({ parts: z.array(StructuredTextPart).min(1) }).strict()]);
const TemporalMemorySummarySchema = z
  .object({
    summary: TextValue,
    topics: z.array(SectionValue),
    openLoops: z.array(SectionValue),
  })
  .strict();

export function parseAgentTemporalMemorySummary(value: unknown): AgentTemporalMemorySummaryResult {
  const parsed = parseNormalizedBamlOutput(TemporalMemorySummarySchema, value);
  return {
    summary: normalizeAgentTextValue(parsed.summary, "temporal digest summary"),
    topics: uniqueParts(parsed.topics.map(unwrapSection), "temporal digest topic"),
    openLoops: uniqueParts(parsed.openLoops.map(unwrapSection), "temporal digest open loop"),
  };
}

function uniqueParts(values: readonly (string | AgentTextParts)[], label: string): AgentTextParts[] {
  const unique = new Map<string, AgentTextParts>();
  for (const value of values) {
    const normalized = normalizeAgentTextValue(value, label);
    const key = JSON.stringify(normalized).normalize("NFKC").toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, createAgentTextParts(normalized));
  }
  return [...unique.values()];
}

function unwrapSection(value: string | AgentTextParts | { readonly parts: AgentTextParts }): string | AgentTextParts {
  return typeof value === "object" && value !== null && "parts" in value ? value.parts : value;
}
