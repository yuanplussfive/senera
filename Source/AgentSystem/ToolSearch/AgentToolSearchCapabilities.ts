import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type {
  ToolSearchCapabilityFacetsManifest,
  ToolSearchCapabilityManifest,
  ToolSearchCapabilityRiskManifest,
} from "../Types/AgentToolContractTypes.js";
import type { AgentToolSearchCapabilityMatch, ToolSearchDocument } from "./AgentToolSearchTypes.js";

export function matchToolCapabilities(
  doc: ToolSearchDocument,
  queryTokens: readonly string[],
  tokenizer: AgentToolSearchTokenizer,
): AgentToolSearchCapabilityMatch[] {
  return matchCapabilityManifests(doc.capabilities, queryTokens, tokenizer);
}

/**
 * Matches a capability contract independently of its enclosing tool document.
 * The ranker uses the same declared-facet evidence as the result projector, so
 * a producer's Actions/Targets declaration has one interpretation throughout
 * the retrieval pipeline.
 */
export function matchCapabilityManifests(
  capabilities: readonly ToolSearchCapabilityManifest[],
  queryTokens: readonly string[],
  tokenizer: AgentToolSearchTokenizer,
): AgentToolSearchCapabilityMatch[] {
  const querySet = new Set(queryTokens);
  return capabilities
    .map((capability) => matchCapability(capability, querySet, tokenizer))
    .filter((entry): entry is AgentToolSearchCapabilityMatch => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function capabilitySearchText(
  capability: ToolSearchCapabilityManifest,
  options: {
    includeRisk: boolean;
  },
): string {
  return [
    capability.Id,
    capability.Title,
    capability.Description,
    ...capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values),
    ...(capability.Aliases ?? []),
    ...(options.includeRisk ? [capabilityRiskText(capability.Risk)] : []),
  ]
    .filter(Boolean)
    .join(" ");
}

export function capabilityFacetEntries(
  facets: ToolSearchCapabilityFacetsManifest | undefined,
): Array<{ name: string; values: string[] }> {
  return facets
    ? Object.entries(facets).flatMap(([name, values]) =>
        Array.isArray(values) && values.length > 0 ? [{ name, values }] : [],
      )
    : [];
}

export function capabilityRiskText(risk: ToolSearchCapabilityRiskManifest | undefined): string {
  return [risk?.SideEffect, risk?.Permission, ...(risk?.Notes ?? [])].filter(Boolean).join(" ");
}

function matchCapability(
  capability: ToolSearchCapabilityManifest,
  queryTokens: Set<string>,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolSearchCapabilityMatch | undefined {
  const matchedFacets = capabilityFacetEntries(capability.Facets)
    .filter((entry) => facetMatchesQuery(entry.values, queryTokens, tokenizer))
    .map((entry) => entry.name);
  const semanticText = capabilitySearchText(capability, {
    includeRisk: false,
  });
  const semanticMatches = tokenizer
    .tokenizeContent(semanticText)
    .filter((token) => tokenizer.isIndependentContentToken(token) && queryTokens.has(token)).length;
  const score = matchedFacets.length + semanticMatches * 0.2;
  if (score <= 0) {
    return undefined;
  }

  return {
    id: capability.Id,
    title: capability.Title ?? capability.Id,
    score: Number(score.toFixed(3)),
    matchedFacets,
    risk: projectCapabilityRisk(capability.Risk),
  };
}

function facetMatchesQuery(
  values: readonly string[],
  queryTokens: Set<string>,
  tokenizer: AgentToolSearchTokenizer,
): boolean {
  return values.some((value) =>
    tokenizer
      .tokenizeContent(value)
      .some((token) => tokenizer.isIndependentContentToken(token) && queryTokens.has(token)),
  );
}

function projectCapabilityRisk(
  risk: ToolSearchCapabilityRiskManifest | undefined,
): AgentToolSearchCapabilityMatch["risk"] | undefined {
  return risk
    ? {
        sideEffect: risk.SideEffect,
        permission: risk.Permission,
      }
    : undefined;
}
