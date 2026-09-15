import type { AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import { readAgentMemorySourceText } from "../Memory/AgentMemorySourceText.js";
import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";
import { agentContinuityObservationUri } from "./AgentContinuityObservationProjection.js";

/** The provider-facing text and host-owned identity for one semantic document. */
export interface AgentContinuitySemanticDocument {
  readonly uri: string;
  readonly text: string;
}

/** Uses the same source text for lexical and semantic recall. */
export function projectAgentContinuitySemanticDocument(
  observation: Pick<AgentContinuityObservation, "uri" | "summary" | "searchText">,
): AgentContinuitySemanticDocument | undefined {
  const text = observation.searchText?.trim() || observation.summary.trim();
  return text ? { uri: observation.uri, text } : undefined;
}

/** Projects persisted physical evidence without indexing episode metadata. */
export function projectAgentContinuityPhysicalSemanticDocument(
  source: AgentMemorySourceRecord,
): AgentContinuitySemanticDocument | undefined {
  const text = physicalSourceText(source);
  return text
    ? {
        uri: agentContinuityObservationUri(source.uri),
        text,
      }
    : undefined;
}

export function projectAgentContinuityPhysicalSemanticDocuments(
  sources: readonly AgentMemorySourceRecord[],
): AgentContinuitySemanticDocument[] {
  return uniqueAgentContinuitySemanticDocuments(
    sources.flatMap((source) => {
      const document = projectAgentContinuityPhysicalSemanticDocument(source);
      return document ? [document] : [];
    }),
  );
}

function physicalSourceText(source: AgentMemorySourceRecord): string {
  const text = readAgentMemorySourceText(
    source,
    source.sourceKind === "user_message" ? "content_first" : "summary_first",
  );
  if (!text) return "";
  return source.toolName.trim() ? `${source.toolName.trim()}\n${text}` : text;
}

export function uniqueAgentContinuitySemanticDocuments(
  documents: readonly AgentContinuitySemanticDocument[],
): AgentContinuitySemanticDocument[] {
  return [...new Map(documents.map((document) => [document.uri, document] as const)).values()];
}
