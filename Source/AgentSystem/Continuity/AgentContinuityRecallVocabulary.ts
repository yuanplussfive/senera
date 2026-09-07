export interface AgentContinuityRecallTermStatistics {
  readonly documentFrequency: number;
  readonly informationScore: number;
}

/**
 * Statistics shared by the lexical index and the local query planner.
 * Documents are counted once per term, so aliases cannot inflate frequency.
 */
export interface AgentContinuityRecallVocabulary {
  readonly documentCount?: number;
  readonly statistics?: (term: string) => AgentContinuityRecallTermStatistics;
  readonly informationScore?: (term: string) => number;
  readonly isInformative: (term: string) => boolean;
}

/** Builds a small in-memory vocabulary from already tokenized documents. */
export function buildAgentContinuityRecallVocabulary(
  documents: readonly (readonly string[])[],
): AgentContinuityRecallVocabulary {
  const frequencies = new Map<string, number>();
  for (const document of documents) {
    const terms = new Set(document.map(normalizeAgentContinuityRecallTerm).filter(Boolean));
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }

  const documentCount = documents.length;
  const maximumInformation = informationScore(documentCount, 0);
  const statistics = (term: string): AgentContinuityRecallTermStatistics => {
    const normalized = normalizeAgentContinuityRecallTerm(term);
    const documentFrequency = frequencies.get(normalized) ?? 0;
    return {
      documentFrequency,
      informationScore: normalizeInformationScore(
        informationScore(documentCount, documentFrequency),
        maximumInformation,
      ),
    };
  };

  return {
    documentCount,
    statistics,
    informationScore: (term) => statistics(term).informationScore,
    isInformative: (term) => {
      const normalized = normalizeAgentContinuityRecallTerm(term);
      if (!normalized) return false;
      if (documentCount <= 1) return true;
      return (frequencies.get(normalized) ?? 0) < documentCount;
    },
  };
}

export function normalizeAgentContinuityRecallTerm(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function informationScore(documentCount: number, documentFrequency: number): number {
  if (documentCount <= 0) return 1;
  return Math.log((documentCount + 1) / (documentFrequency + 1)) + 1;
}

function normalizeInformationScore(value: number, maximum: number): number {
  return maximum > 0 ? value / maximum : 0;
}
