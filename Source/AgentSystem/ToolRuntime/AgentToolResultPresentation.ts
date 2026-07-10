import {
  AgentToolResultPresentationType,
  type AgentToolResultPresentation,
  type AgentToolResultPresentationChange,
  type AgentToolResultPresentationEvidence,
  type AgentToolResultPresentationFact,
  type AgentToolResultPresentationStatus,
  type ExecutedToolCallResult,
} from "../Types/ToolRuntimeTypes.js";

/**
 * Separates the model's complete tool observation from the compact, human
 * readable result surface. Plugin evidence owns the display wording.
 */
export function projectAgentToolResultPresentation(
  result: ExecutedToolCallResult,
): AgentToolResultPresentation {
  const status = readStatus(result);
  const evidence = projectEvidence(result);
  const changes = projectChanges(result);
  const facts = projectFacts(result);
  const fallback = readResultText(result.result);
  const headline = evidence[0]?.display
    ?? changes[0]?.summary
    ?? fallback
    ?? result.name;
  const summary = buildSummary(evidence, changes, fallback, headline);

  return {
    type: AgentToolResultPresentationType,
    version: 1,
    status,
    headline,
    summary,
    facts,
    evidence,
    changes,
    artifactUri: result.artifact?.artifactUri,
  };
}

function readStatus(result: ExecutedToolCallResult): AgentToolResultPresentationStatus {
  if (
    readRecord(result.result)?.error
    || (result.process.exitCode !== null && result.process.exitCode !== 0)
    || result.process.signal
  ) {
    return "failure";
  }
  return result.result === undefined || result.result === null ? "empty" : "success";
}

function projectEvidence(result: ExecutedToolCallResult): AgentToolResultPresentationEvidence[] {
  const seen = new Set<string>();
  return (result.artifact?.evidence ?? []).flatMap((entry) => {
    const key = entry.evidenceUri || entry.key;
    if (!key || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      evidenceUri: entry.evidenceUri,
      kind: entry.kind,
      display: entry.display,
      label: entry.label,
      source: entry.source,
      locator: entry.locator,
      confidence: entry.confidence,
    }];
  });
}

function projectFacts(result: ExecutedToolCallResult): AgentToolResultPresentationFact[] {
  const summaryFacts = result.artifact?.structuredSummary?.facts ?? [];
  const fallbackFacts = result.artifact?.evidence.flatMap((entry) => entry.modelSlots.map((slot) => ({
    name: slot.name,
    value: slot.value,
    kind: entry.kind,
    evidenceUri: entry.evidenceUri,
    confidence: entry.confidence,
  }))) ?? [];
  const facts = summaryFacts.length > 0
    ? summaryFacts.map((fact) => ({
        name: fact.name,
        value: fact.value,
        kind: fact.kind,
        evidenceUri: fact.evidenceUri,
        confidence: fact.confidence,
      }))
    : fallbackFacts;
  const seen = new Set<string>();
  return facts.flatMap((fact) => {
    const name = fact.name.trim();
    const value = fact.value.trim();
    const key = `${name}\u0000${value}\u0000${fact.evidenceUri ?? ""}`;
    if (!name || !value || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ ...fact, name, value }];
  });
}

function projectChanges(result: ExecutedToolCallResult): AgentToolResultPresentationChange[] {
  const changes = result.artifact?.delta ?? [];
  const seen = new Set<string>();
  return changes.flatMap((change) => {
    const key = `${change.kind}\u0000${change.status}\u0000${change.key}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      kind: change.kind,
      status: change.status,
      key: change.key,
      summary: change.summary,
    }];
  });
}

function buildSummary(
  evidence: readonly AgentToolResultPresentationEvidence[],
  changes: readonly AgentToolResultPresentationChange[],
  fallback: string | undefined,
  headline: string,
): string | undefined {
  const details = uniqueText([
    ...evidence.map((entry) => entry.display),
    ...changes.map((entry) => entry.summary),
    fallback,
  ]).filter((text) => text !== headline);
  return details.length > 0 ? details.join("\n") : undefined;
}

function readResultText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  const record = readRecord(value);
  return record ? readSemanticText(record) : undefined;
}

function readSemanticText(value: Record<string, unknown>): string | undefined {
  const candidates = [
    value.headline,
    value.summary,
    value.message,
    value.text,
    value.output,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const text = normalizeText(candidate);
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function normalizeText(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
