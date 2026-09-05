import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import { normalizeAgentContinuityConceptAlias } from "./AgentContinuityConceptCatalog.js";
import type { AgentContinuityGraphEntity } from "./AgentContinuityGraphTypes.js";
import type { AgentContinuityEntityKind } from "./AgentContinuityRelationCatalog.js";

export interface AgentContinuityEntityAliasResolutionInput {
  readonly label: string;
  readonly kind: AgentContinuityEntityKind;
  readonly entities: readonly AgentContinuityGraphEntity[];
}

/**
 * Resolves only unambiguous identifier-bearing containment aliases. This is
 * intentionally narrower than recall: an alias write changes graph identity,
 * so generic words and ambiguous candidates must remain separate entities.
 */
export class AgentContinuityEntityAliasResolver {
  private readonly tokenizer = new AgentToolSearchTokenizer();

  resolve(input: AgentContinuityEntityAliasResolutionInput): readonly string[] {
    const label = input.label.trim();
    if (!label) throw new Error("Continuity entity alias resolution requires a label.");
    const matchingEntities = input.entities.filter(
      (entity) =>
        entity.status === "active" && kindsCanShareIdentity(entity.kind, input.kind) && this.matches(label, entity),
    );
    if (matchingEntities.length !== 1) return [];
    return [matchingEntities[0]!.label];
  }

  private matches(label: string, entity: AgentContinuityGraphEntity): boolean {
    return [entity.label, ...entity.aliases].some((alias) => this.isIdentifierContainmentAlias(label, alias));
  }

  private isIdentifierContainmentAlias(left: string, right: string): boolean {
    const normalizedLeft = normalizeAgentContinuityConceptAlias(left);
    const normalizedRight = normalizeAgentContinuityConceptAlias(right);
    if (normalizedLeft === normalizedRight) return true;
    const [shorterText, longerText, shorterNormalized, longerNormalized] =
      normalizedLeft.length < normalizedRight.length
        ? [left, right, normalizedLeft, normalizedRight]
        : [right, left, normalizedRight, normalizedLeft];
    if (!longerNormalized.includes(shorterNormalized)) return false;

    const shorterTerms = new Set(this.tokenizer.tokenizeContent(shorterText));
    const longerTerms = new Set(this.tokenizer.tokenizeContent(longerText));
    const identifierTerms = [...shorterTerms].filter(isIdentifierBearingTerm);
    if (identifierTerms.length === 0 || !identifierTerms.every((term) => longerTerms.has(term))) return false;
    return [...longerTerms].filter(isIdentifierBearingTerm).every((term) => shorterTerms.has(term));
  }
}

function kindsCanShareIdentity(left: AgentContinuityEntityKind, right: AgentContinuityEntityKind): boolean {
  return left === right || left === "concept" || right === "concept";
}

function isIdentifierBearingTerm(term: string): boolean {
  return /[\p{Script=Latin}\p{N}]/u.test(term);
}
