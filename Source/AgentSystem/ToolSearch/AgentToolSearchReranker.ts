import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { ToolSearchCapabilityManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";
import type { AgentToolResourceQueryShape } from "../ToolRuntime/AgentToolResourceDiscovery.js";
import { capabilityFacetEntries } from "./AgentToolSearchCapabilities.js";

export interface AgentToolSearchRerankDocument {
  toolName: string;
  title: string;
  ownerName: string;
  ownerTitle: string;
  sourceText: string;
  tags: string;
  summary: string;
  whenToUse: string;
  examples: string;
  /** Complete producer-declared example requests, kept separate from aliases. */
  examplePhrases?: readonly string[];
  avoid: string;
  capabilityText: string;
  capabilityFacets: string;
  capabilityRiskText: string;
  /** Structured contracts remain the authority for operation-level relevance. */
  capabilities?: readonly ToolSearchCapabilityManifest[];
  params: string;
  /** Explicit tool, capability, and alias phrases declared by the producer. */
  identityPhrases: readonly string[];
  /** Machine-stable producer identifiers, separate from natural-language aliases. */
  formalIdentityPhrases?: readonly string[];
  /** Query shapes declared by the resource capabilities used by this tool. */
  resourceQueryShapes?: readonly AgentToolResourceQueryShape[];
  permissions: string;
  priority: number;
  coreText: string;
}

export interface AgentToolSearchRerankEntry {
  toolName: string;
  score: number;
}

export interface AgentToolSearchRerankContext<RankerName extends string> {
  /** Original request text preserves contiguous declared-identity evidence. */
  query: string;
  queryTokens: readonly string[];
  resourceQueryShapes: readonly AgentToolResourceQueryShape[];
  plannerTagTokens: readonly string[];
  rankers: Record<RankerName, Map<string, number>>;
  docsByTool: ReadonlyMap<string, AgentToolSearchRerankDocument>;
  memoryByTool: ReadonlyMap<string, AgentToolSearchMemoryEvidence>;
  inverseDocumentFrequency: (token: string) => number;
}

type TextFeatureField = {
  feature: string;
  read: (doc: AgentToolSearchRerankDocument) => string;
};

interface PreparedRerankContext {
  readonly queryTokens: ReadonlySet<string>;
  readonly plannerTagTokens: ReadonlySet<string>;
  readonly queryInformation: number;
  readonly plannerTagInformation: number;
}

interface RerankDocumentStaticFeatures {
  readonly coreTokens: ReadonlySet<string>;
  readonly avoidTokens: ReadonlySet<string>;
  readonly riskTokenCount: number;
  readonly textTokensByFeature: ReadonlyMap<string, ReadonlySet<string>>;
  readonly capabilityFacetGroups: ReadonlyArray<ReadonlyArray<ReadonlySet<string>>>;
  readonly resourceQueryShapes: ReadonlySet<AgentToolResourceQueryShape>;
  readonly permissionCount: number;
}

const TextFeatureFields = [
  { feature: "field.tool_name", read: (doc) => doc.toolName },
  { feature: "field.title", read: (doc) => doc.title },
  { feature: "field.owner", read: (doc) => `${doc.ownerName} ${doc.ownerTitle}` },
  { feature: "field.tags", read: (doc) => doc.tags },
  { feature: "field.summary", read: (doc) => doc.summary },
  { feature: "field.when_to_use", read: (doc) => doc.whenToUse },
  { feature: "field.capability_text", read: (doc) => doc.capabilityText },
  { feature: "field.capability_facets", read: (doc) => doc.capabilityFacets },
  { feature: "field.params", read: (doc) => doc.params },
  { feature: "field.permissions", read: (doc) => doc.permissions },
] satisfies TextFeatureField[];

export const AgentToolSearchRerankDefaultWeights = {
  "base.rrf": 0.42,
  "rank.bm25": 0.18,
  "rank.exact": 0.18,
  "rank.example": 0.24,
  "rank.fuzzy": 0.12,
  "rank.semantic": 0.18,
  "rank.structural": 0.24,
  "rank.memory": 0.14,
  "match.coverage": 0.16,
  "match.information": 0.18,
  "match.identity_phrase": 0.36,
  "match.capability_facets": 0.28,
  "field.tool_name": 0.18,
  "field.title": 0.14,
  "field.owner": 0.08,
  "field.tags": 0.24,
  "field.summary": 0.13,
  "field.when_to_use": 0.14,
  "field.capability_text": 0.2,
  "field.capability_facets": 0.24,
  "field.params": 0.13,
  "field.permissions": 0.04,
  "field.avoid": -0.32,
  "risk.side_effect": -0.05,
  "planner_tags.coverage": 0.14,
  "planner_tags.tags": 0.24,
  "planner_tags.core": 0.12,
  "memory.confidence": 0.16,
  "memory.evidence": 0.08,
  "permission.count": -0.03,
  "query.resource_shape": 1.2,
} satisfies Record<string, number>;

export class AgentToolSearchReranker<RankerName extends string> {
  private readonly weights: Record<string, number>;
  /**
   * Tool contracts are immutable for the lifetime of one search index. Cache
   * their token views by document identity so reranking does not repeatedly
   * run Jieba over the same declarations on every request.
   */
  private readonly staticFeaturesByDocument = new WeakMap<
    AgentToolSearchRerankDocument,
    RerankDocumentStaticFeatures
  >();

  constructor(
    private readonly config: ResolvedAgentToolSearchConfig["Rerank"],
    private readonly tokenizer: AgentToolSearchTokenizer,
  ) {
    this.weights = {
      ...AgentToolSearchRerankDefaultWeights,
      ...config.FeatureWeights,
    };
  }

  rerank(
    entries: readonly AgentToolSearchRerankEntry[],
    context: AgentToolSearchRerankContext<RankerName>,
  ): AgentToolSearchRerankEntry[] {
    if (!this.config.Enabled || entries.length === 0) {
      return [...entries];
    }

    const maxBaseScore = Math.max(...entries.map((entry) => entry.score), Number.EPSILON);
    const prepared = this.prepareContext(context);

    return entries
      .map((entry) => ({
        ...entry,
        score: entry.score + this.config.ScoreScale * this.score(this.features(entry, context, prepared, maxBaseScore)),
      }))
      .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName));
  }

  private score(features: Record<string, number>): number {
    return Object.entries(features).reduce((total, [name, value]) => total + (this.weights[name] ?? 0) * value, 0);
  }

  private features(
    entry: AgentToolSearchRerankEntry,
    context: AgentToolSearchRerankContext<RankerName>,
    prepared: PreparedRerankContext,
    maxBaseScore: number,
  ): Record<string, number> {
    const doc = context.docsByTool.get(entry.toolName);
    if (!doc) {
      return {};
    }

    const staticFeatures = this.staticFeatures(doc);
    const memory = context.memoryByTool.get(entry.toolName);
    const rankFeatures = Object.fromEntries(
      typedEntries(context.rankers).flatMap(([name, ranks]) => {
        const rank = ranks.get(entry.toolName);
        return rank === undefined ? [] : [[`rank.${name}`, reciprocalRank(rank)]];
      }),
    );
    const fieldFeatures = Object.fromEntries(
      TextFeatureFields.map((field) => [
        field.feature,
        this.informationOverlap(
          staticFeatures.textTokensByFeature.get(field.feature) ?? new Set(),
          prepared.queryTokens,
          prepared.queryInformation,
          context,
        ),
      ]),
    );

    return {
      "base.rrf": entry.score / maxBaseScore,
      ...rankFeatures,
      "match.coverage": this.coverage(staticFeatures.coreTokens, prepared.queryTokens),
      "match.information": this.informationOverlap(
        staticFeatures.coreTokens,
        prepared.queryTokens,
        prepared.queryInformation,
        context,
      ),
      "match.identity_phrase": this.identityPhraseMatch(doc, context.query),
      "match.capability_facets": this.capabilityFacetMatch(staticFeatures, prepared.queryTokens),
      ...fieldFeatures,
      "field.avoid": this.informationOverlap(
        staticFeatures.avoidTokens,
        prepared.queryTokens,
        prepared.queryInformation,
        context,
      ),
      "query.resource_shape": this.resourceShapeMatch(context.resourceQueryShapes, staticFeatures),
      "risk.side_effect": boundedLog(staticFeatures.riskTokenCount),
      "planner_tags.coverage": this.coverage(staticFeatures.coreTokens, prepared.plannerTagTokens),
      "planner_tags.tags": this.informationOverlap(
        staticFeatures.textTokensByFeature.get("field.tags") ?? new Set(),
        prepared.plannerTagTokens,
        prepared.plannerTagInformation,
        context,
      ),
      "planner_tags.core": this.informationOverlap(
        staticFeatures.coreTokens,
        prepared.plannerTagTokens,
        prepared.plannerTagInformation,
        context,
      ),
      "memory.confidence": memory?.confidence ?? 0,
      "memory.evidence": memory ? boundedLog(memory.evidence) : 0,
      "permission.count": boundedLog(staticFeatures.permissionCount),
    };
  }

  private prepareContext(context: AgentToolSearchRerankContext<RankerName>): PreparedRerankContext {
    const queryTokens = new Set(context.queryTokens);
    const plannerTagTokens = new Set(context.plannerTagTokens);
    return {
      queryTokens,
      plannerTagTokens,
      queryInformation: this.queryInformation(queryTokens, context),
      plannerTagInformation: this.queryInformation(plannerTagTokens, context),
    };
  }

  private staticFeatures(doc: AgentToolSearchRerankDocument): RerankDocumentStaticFeatures {
    const cached = this.staticFeaturesByDocument.get(doc);
    if (cached) return cached;

    const textTokensByFeature = new Map(
      TextFeatureFields.map((field) => [field.feature, this.contentTokens(field.read(doc))] as const),
    );
    const staticFeatures: RerankDocumentStaticFeatures = {
      coreTokens: this.contentTokens(doc.coreText),
      avoidTokens: this.contentTokens(doc.avoid),
      // Risk is a declaration-size regularizer, not query relevance. Keep
      // the original full token view here; using content-only tokens would
      // subtly change an established ranking signal while caching it.
      riskTokenCount: this.tokenizer.tokenize(doc.capabilityRiskText).length,
      textTokensByFeature,
      capabilityFacetGroups: (doc.capabilities ?? []).map((capability) =>
        capabilityFacetEntries(capability.Facets).map(
          (facet) =>
            new Set(
              facet.values.flatMap((value) =>
                this.tokenizer
                  .tokenizeContent(value)
                  .filter((token) => this.tokenizer.isIndependentContentToken(token)),
              ),
            ),
        ),
      ),
      resourceQueryShapes: new Set(doc.resourceQueryShapes ?? []),
      permissionCount: doc.permissions.split(/\s+/).filter(Boolean).length,
    };
    this.staticFeaturesByDocument.set(doc, staticFeatures);
    return staticFeatures;
  }

  private contentTokens(text: string): ReadonlySet<string> {
    return new Set(this.tokenizer.tokenizeContent(text));
  }

  private coverage(tokens: ReadonlySet<string>, queryTokens: ReadonlySet<string>): number {
    if (queryTokens.size === 0) {
      return 0;
    }

    return [...queryTokens].filter((token) => tokens.has(token)).length / queryTokens.size;
  }

  private identityPhraseMatch(doc: AgentToolSearchRerankDocument, query: string): number {
    return doc.identityPhrases.some((phrase) => this.tokenizer.containsDeclaredPhrase(phrase, query)) ? 1 : 0;
  }

  /**
   * Identity aliases are useful for direct lookup, but matching an explicit
   * capability facet such as Action=search and Target=workspace is stronger
   * evidence of the user's requested operation. Limit the feature to the
   * declared facet count, not free-form description text.
   */
  private capabilityFacetMatch(staticFeatures: RerankDocumentStaticFeatures, queryTokens: ReadonlySet<string>): number {
    const strongest = Math.max(
      0,
      ...staticFeatures.capabilityFacetGroups.map(
        (facets) => facets.filter((tokens) => [...tokens].some((token) => queryTokens.has(token))).length,
      ),
    );
    return boundedLog(strongest);
  }

  private informationOverlap(
    tokens: ReadonlySet<string>,
    queryTokens: ReadonlySet<string>,
    queryInformation: number,
    context: AgentToolSearchRerankContext<RankerName>,
  ): number {
    if (queryInformation <= 0) {
      return 0;
    }

    const information = [...queryTokens]
      .filter((token) => tokens.has(token))
      .reduce((total, token) => total + context.inverseDocumentFrequency(token), 0);
    return Math.min(1, information / queryInformation);
  }

  private queryInformation(queryTokens: Set<string>, context: AgentToolSearchRerankContext<RankerName>): number {
    return [...queryTokens].reduce((total, token) => total + context.inverseDocumentFrequency(token), 0);
  }

  private resourceShapeMatch(
    queryShapes: readonly AgentToolResourceQueryShape[],
    staticFeatures: RerankDocumentStaticFeatures,
  ): number {
    if (queryShapes.length === 0) return 0;
    return queryShapes.some((shape) => staticFeatures.resourceQueryShapes.has(shape)) ? 1 : 0;
  }
}

function reciprocalRank(rank: number): number {
  return 1 / Math.log2(rank + 1);
}

function typedEntries<T extends Record<string, unknown>>(
  value: T,
): Array<{ [K in keyof T & string]: [K, T[K]] }[keyof T & string]> {
  return Object.entries(value) as Array<{ [K in keyof T & string]: [K, T[K]] }[keyof T & string]>;
}

function boundedLog(value: number): number {
  return Math.tanh(Math.log1p(Math.max(0, value)));
}
