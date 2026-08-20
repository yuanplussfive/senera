import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { previewAgentText } from "../Text/AgentTextProjection.js";
import type { AgentToolArtifactAssetReference, AgentToolEvidenceCandidate } from "../Types/ToolRuntimeTypes.js";

const AutomaticEvidenceLimits = {
  maxRecords: 32,
  maxDisplayCharacters: 512,
  maxUrls: 16,
  maxDepth: 6,
} as const;

export interface AgentToolFeedbackAdapterOptions {
  readonly source?: string;
}

/**
 * Creates a conservative provenance layer for every successful tool result.
 *
 * The candidate only contains bounded scalar facts and references. The full
 * redacted result is still published by the Artifact recorder, so this layer
 * never replaces the durable source of truth and does not require a plugin
 * specific output schema.
 */
export function createAgentToolEvidenceCandidates(
  value: unknown,
  options: AgentToolFeedbackAdapterOptions = {},
): AgentToolEvidenceCandidate[] {
  if (isEmptyFeedback(value)) return [];

  const source = options.source?.trim() || "Tool result";
  const candidates: AgentToolEvidenceCandidate[] = [];
  projectRootCandidate(value, source, candidates);
  collectUrlCandidates(value, "$", source, candidates, new Set<string>(), 0);
  return candidates.slice(0, AutomaticEvidenceLimits.maxRecords);
}

export function readAgentToolEvidenceCandidates(value: unknown): AgentToolEvidenceCandidate[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is AgentToolEvidenceCandidate => isAgentUnknownRecord(entry))
    : [];
}

/**
 * Resolves adapter-declared asset IDs after the Artifact transaction has
 * materialized their files. This keeps the result adapter independent from
 * filesystem layout while giving the model a usable, traceable locator.
 */
export function attachAgentToolEvidenceAssets(
  candidates: readonly AgentToolEvidenceCandidate[],
  assets: readonly AgentToolArtifactAssetReference[] = [],
): AgentToolEvidenceCandidate[] {
  if (assets.length === 0) return [...candidates];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return candidates.map((candidate) => {
    const assetId = isAgentUnknownRecord(candidate.metadata) ? candidate.metadata.assetId : undefined;
    const asset = typeof assetId === "string" ? assetsById.get(assetId) : undefined;
    if (!asset) return candidate;

    const facts = [
      ...(candidate.facts ?? []),
      { name: "asset_uri", value: asset.workspacePath },
      { name: "content_locator", value: candidate.locator },
    ];
    return {
      ...candidate,
      locator: asset.workspacePath,
      facts: uniqueFacts(facts),
      artifactRefs: [...new Set([...(candidate.artifactRefs ?? []), asset.workspacePath])],
      metadata: {
        ...(candidate.metadata ?? {}),
        assetPath: asset.workspacePath,
      },
    };
  });
}

function projectRootCandidate(value: unknown, source: string, candidates: AgentToolEvidenceCandidate[]): void {
  const text = typeof value === "string" ? value.trim() : "";
  const shape = Array.isArray(value) ? "array" : isAgentUnknownRecord(value) ? "object" : typeof value;
  candidates.push({
    key: "result:$",
    kind: "tool-output",
    locator: "$",
    display: text
      ? previewAgentText(text, AutomaticEvidenceLimits.maxDisplayCharacters)
      : "Tool returned structured output",
    label: "Tool result",
    source,
    confidence: 1,
    artifactRefs: ["raw"],
    metadata: { automatic: true, shape },
  });
}

function collectUrlCandidates(
  value: unknown,
  locator: string,
  source: string,
  candidates: AgentToolEvidenceCandidate[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > AutomaticEvidenceLimits.maxDepth || candidates.length >= AutomaticEvidenceLimits.maxRecords) return;

  if (typeof value === "string") {
    const url = readWebUrl(value);
    if (!url || seen.has(url) || seen.size >= AutomaticEvidenceLimits.maxUrls) return;
    seen.add(url);
    candidates.push({
      key: `source:${url}`,
      kind: "source",
      locator: url,
      display: url,
      label: "Source",
      source,
      confidence: 1,
      facts: [{ name: "url", value: url }],
      metadata: { automatic: true, locator: `${locator}` },
    });
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      collectUrlCandidates(entry, `${locator}[${index}]`, source, candidates, seen, depth + 1);
    }
    return;
  }

  if (!isAgentUnknownRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    collectUrlCandidates(entry, `${locator}.${key}`, source, candidates, seen, depth + 1);
  }
}

function isEmptyFeedback(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0) ||
    (isAgentUnknownRecord(value) && Object.keys(value).length === 0)
  );
}

function readWebUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("senera://") || trimmed.startsWith("data:")) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function uniqueFacts(
  facts: readonly { readonly name: string; readonly value: unknown }[],
): { name: string; value: unknown }[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.name}\u0000${JSON.stringify(fact.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
