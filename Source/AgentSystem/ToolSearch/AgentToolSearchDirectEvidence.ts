import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentToolSearchResult, ToolSearchDocument } from "./AgentToolSearchTypes.js";

export interface AgentToolSearchDirectEvidenceOptions {
  readonly query: string;
  readonly queryTokens: readonly string[];
  readonly results: readonly AgentToolSearchResult[];
  readonly documentsByTool: ReadonlyMap<string, ToolSearchDocument>;
  readonly tokenizer: AgentToolSearchTokenizer;
}

/**
 * Returns candidates whose producer declarations prove a direct operation
 * match and whose proof is unique in the current candidate set.
 *
 * A score curve answers how much retrieval evidence separates candidates; it
 * cannot tell whether a generic word such as "guide" proves an operation.
 * This pass derives proof keys only from producer declarations and the query,
 * then rejects keys shared by multiple tools. It has no vocabulary, language,
 * provider, or tool-name policy.
 */
export function deriveAgentToolSearchDirectMatchNames(
  options: AgentToolSearchDirectEvidenceOptions,
): ReadonlySet<string> {
  const proofsByTool = new Map<string, Set<string>>();
  const queryTokenSet = new Set(options.queryTokens);
  const structuralCount = options.results.filter((result) => result.ranks.structural !== undefined).length;

  for (const result of options.results) {
    const document = options.documentsByTool.get(result.toolName);
    if (!document) continue;
    const proofs = new Set<string>();
    const completeCoverage =
      options.queryTokens.length > 1 && options.queryTokens.every((token) => result.matchedTerms.includes(token));
    const compositeFacet = result.matchedCapabilities.some((match) => match.matchedFacets.length > 1);

    for (const example of document.examplePhrases ?? []) {
      if (options.tokenizer.matchesExactPhrase(example, options.query)) {
        proofs.add(`example:${options.tokenizer.canonicalPhrase(example)}`);
      }
    }

    for (const identity of document.identityPhrases) {
      if (isCompleteDeclaredIdentity(identity, options.query, options.queryTokens, queryTokenSet, options.tokenizer)) {
        proofs.add(`identity:${options.tokenizer.canonicalPhrase(identity)}`);
      }
    }

    if (completeCoverage) {
      proofs.add(`coverage:${[...queryTokenSet].sort().join("\u001f")}`);
    }

    for (const capability of result.matchedCapabilities) {
      if (capability.matchedFacets.length > 1) {
        proofs.add(
          `facets:${[...capability.matchedFacets].sort().join("\u001f")}:${[...queryTokenSet].sort().join("\u001f")}`,
        );
      }
    }

    if (
      result.ranks.structural !== undefined &&
      (structuralCount === 1 || result.matchedTerms.length > 0 || compositeFacet || completeCoverage)
    ) {
      proofs.add(`structure:${[...result.matchedTerms].sort().join("\u001f")}`);
    }

    if (proofs.size > 0) proofsByTool.set(result.toolName, proofs);
  }

  const proofFrequency = new Map<string, number>();
  for (const proofs of proofsByTool.values()) {
    for (const proof of proofs) proofFrequency.set(proof, (proofFrequency.get(proof) ?? 0) + 1);
  }

  return new Set(
    [...proofsByTool.entries()]
      .filter(([, proofs]) => [...proofs].some((proof) => proofFrequency.get(proof) === 1))
      .map(([toolName]) => toolName),
  );
}

function isCompleteDeclaredIdentity(
  identity: string,
  query: string,
  queryTokens: readonly string[],
  queryTokenSet: ReadonlySet<string>,
  tokenizer: AgentToolSearchTokenizer,
): boolean {
  const identityTokens = tokenizer
    .tokenizeContent(identity)
    .filter((token) => tokenizer.isIndependentContentToken(token));
  if (identityTokens.length === 0) return false;
  if (tokenizer.matchesExactPhrase(identity, query)) return true;
  if (
    !tokenizer.containsDeclaredPhrase(identity, query) &&
    !tokenizer.containsDeclaredIdentitySequence(identity, query)
  ) {
    return false;
  }

  // A multi-atom producer identity remains direct when it is embedded in a
  // larger request. A one-atom identity becomes direct only when it explains
  // the full independent request, which prevents a coincidental generic word
  // from becoming execution authority. This relation is token-structural and
  // applies equally to every script.
  return (
    identityTokens.length > 1 ||
    (queryTokens.length > 0 && queryTokens.every((token) => queryTokenSet.has(token) && identityTokens.includes(token)))
  );
}
