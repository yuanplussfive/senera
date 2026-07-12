import type { ResolvedAgentToolSearchConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type { AgentToolSearchMemoryEvidence } from "./AgentToolSearchMemory.js";

export interface AgentToolSearchRerankDocument {
  toolName: string;
  title: string;
  pluginName: string;
  pluginTitle: string;
  tags: string;
  summary: string;
  whenToUse: string;
  examples: string;
  avoid: string;
  capabilityText: string;
  capabilityFacets: string;
  capabilityRiskText: string;
  params: string;
  permissions: string;
  priority: number;
  coreText: string;
}

export interface AgentToolSearchRerankEntry {
  toolName: string;
  score: number;
}

export interface AgentToolSearchRerankContext<RankerName extends string> {
  queryTokens: readonly string[];
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

const TextFeatureFields = [
  { feature: "field.tool_name", read: (doc) => doc.toolName },
  { feature: "field.title", read: (doc) => doc.title },
  { feature: "field.plugin", read: (doc) => `${doc.pluginName} ${doc.pluginTitle}` },
  { feature: "field.tags", read: (doc) => doc.tags },
  { feature: "field.summary", read: (doc) => doc.summary },
  { feature: "field.when_to_use", read: (doc) => doc.whenToUse },
  { feature: "field.examples", read: (doc) => doc.examples },
  { feature: "field.capability_text", read: (doc) => doc.capabilityText },
  { feature: "field.capability_facets", read: (doc) => doc.capabilityFacets },
  { feature: "field.params", read: (doc) => doc.params },
  { feature: "field.permissions", read: (doc) => doc.permissions },
] satisfies TextFeatureField[];

export const AgentToolSearchRerankDefaultWeights = {
  "base.rrf": 0.42,
  "rank.bm25": 0.18,
  "rank.exact": 0.18,
  "rank.memory": 0.14,
  "rank.priority": 0.06,
  "match.coverage": 0.16,
  "match.information": 0.18,
  "field.tool_name": 0.18,
  "field.title": 0.14,
  "field.plugin": 0.08,
  "field.tags": 0.24,
  "field.summary": 0.13,
  "field.when_to_use": 0.14,
  "field.examples": 0.1,
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
} satisfies Record<string, number>;

export class AgentToolSearchReranker<RankerName extends string> {
  private readonly weights: Record<string, number>;

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

    const limited = entries.slice(0, this.config.CandidateLimit);
    const rest = entries.slice(this.config.CandidateLimit);
    const maxBaseScore = Math.max(...limited.map((entry) => entry.score), Number.EPSILON);

    return [
      ...limited
        .map((entry) => ({
          ...entry,
          score: entry.score + this.config.ScoreScale * this.score(this.features(entry, context, maxBaseScore)),
        }))
        .sort((left, right) => right.score - left.score || left.toolName.localeCompare(right.toolName)),
      ...rest,
    ];
  }

  private score(features: Record<string, number>): number {
    return Object.entries(features).reduce((total, [name, value]) => total + (this.weights[name] ?? 0) * value, 0);
  }

  private features(
    entry: AgentToolSearchRerankEntry,
    context: AgentToolSearchRerankContext<RankerName>,
    maxBaseScore: number,
  ): Record<string, number> {
    const doc = context.docsByTool.get(entry.toolName);
    if (!doc) {
      return {};
    }

    const queryTokens = new Set(context.queryTokens);
    const plannerTagTokens = new Set(context.plannerTagTokens);
    const queryInformation = this.queryInformation(queryTokens, context);
    const plannerTagInformation = this.queryInformation(plannerTagTokens, context);
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
        this.informationOverlap(field.read(doc), queryTokens, queryInformation, context),
      ]),
    );

    return {
      "base.rrf": entry.score / maxBaseScore,
      ...rankFeatures,
      "match.coverage": this.coverage(doc.coreText, queryTokens),
      "match.information": this.informationOverlap(doc.coreText, queryTokens, queryInformation, context),
      ...fieldFeatures,
      "field.avoid": this.informationOverlap(doc.avoid, queryTokens, queryInformation, context),
      "risk.side_effect": boundedLog(this.tokenizer.tokenize(doc.capabilityRiskText).length),
      "planner_tags.coverage": this.coverage(doc.coreText, plannerTagTokens),
      "planner_tags.tags": this.informationOverlap(doc.tags, plannerTagTokens, plannerTagInformation, context),
      "planner_tags.core": this.informationOverlap(doc.coreText, plannerTagTokens, plannerTagInformation, context),
      "memory.confidence": memory?.confidence ?? 0,
      "memory.evidence": memory ? boundedLog(memory.evidence) : 0,
      "permission.count": boundedLog(doc.permissions.split(/\s+/).filter(Boolean).length),
    };
  }

  private coverage(text: string, queryTokens: Set<string>): number {
    if (queryTokens.size === 0) {
      return 0;
    }

    const tokens = new Set(this.tokenizer.tokenize(text));
    return [...queryTokens].filter((token) => tokens.has(token)).length / queryTokens.size;
  }

  private informationOverlap(
    text: string,
    queryTokens: Set<string>,
    queryInformation: number,
    context: AgentToolSearchRerankContext<RankerName>,
  ): number {
    if (queryInformation <= 0) {
      return 0;
    }

    const tokens = new Set(this.tokenizer.tokenize(text));
    const information = [...queryTokens]
      .filter((token) => tokens.has(token))
      .reduce((total, token) => total + context.inverseDocumentFrequency(token), 0);
    return Math.min(1, information / queryInformation);
  }

  private queryInformation(queryTokens: Set<string>, context: AgentToolSearchRerankContext<RankerName>): number {
    return [...queryTokens].reduce((total, token) => total + context.inverseDocumentFrequency(token), 0);
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
