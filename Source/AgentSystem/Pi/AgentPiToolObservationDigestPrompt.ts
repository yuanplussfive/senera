import type { GroundedDigest } from "../BamlClient/baml_client/types.js";

export interface AgentPiToolObservationDigestSource {
  id: string;
  toolName: string;
  status: string;
  artifactUri?: string;
  content: string;
}

export interface AgentPiToolObservationDigestPromptInput {
  objective?: string;
  targetTokens: number;
  sources: AgentPiToolObservationDigestSource[];
}

export type AgentPiToolObservationDigestDirective =
  | { stage: "condenseToolObservations" }
  | {
      stage: "repairToolObservationDigest";
      invalidDigest: string;
      issues: readonly string[];
    };

export function buildAgentPiToolObservationDigestPromptJson(
  input: AgentPiToolObservationDigestPromptInput,
  directive: AgentPiToolObservationDigestDirective,
): string {
  return JSON.stringify({ digestInput: { ...input, directive } }, null, 2);
}

export function normalizeAgentPiToolObservationDigest(
  digest: GroundedDigest,
  allowedSourceIds: ReadonlySet<string>,
): GroundedDigest {
  const entries = digest.entries.map((entry, index) => {
    const text = entry.text.trim();
    if (!text) throw new Error(`Grounded digest entry ${index} has empty text.`);
    const sources = [...new Set(entry.sources.map((source) => source.trim()).filter(Boolean))];
    if (sources.length === 0) throw new Error(`Grounded digest entry ${index} has no source.`);
    const unknownSources = sources.filter((source) => !allowedSourceIds.has(source));
    if (unknownSources.length > 0) {
      throw new Error(`Grounded digest entry ${index} cites unknown sources: ${unknownSources.join(", ")}`);
    }
    return { text, sources };
  });

  const byText = new Map<string, GroundedDigest["entries"][number]>();
  for (const entry of entries) {
    const existing = byText.get(entry.text);
    byText.set(
      entry.text,
      existing ? { text: entry.text, sources: [...new Set([...existing.sources, ...entry.sources])] } : entry,
    );
  }
  return { entries: [...byText.values()] };
}
