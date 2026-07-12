import crypto from "node:crypto";
import MiniSearch from "minisearch";
import type { RegisteredSkill } from "../Types/PluginRuntimeTypes.js";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import {
  capabilityFacetEntries,
  capabilityRiskText,
  capabilitySearchText,
} from "../ToolSearch/AgentToolSearchCapabilities.js";
import { compareLoadedPluginsForPrompting } from "../Plugin/AgentPluginOrdering.js";

interface SkillSearchDocument {
  id: string;
  skillName: string;
  title: string;
  pluginName: string;
  tags: string;
  summary: string;
  useCases: string;
  examples: string;
  avoid: string;
  capabilityText: string;
  capabilityFacets: string;
  capabilityRiskText: string;
  recommendedTools: string;
}

export interface AgentSkillSelectionResult {
  skill: RegisteredSkill;
  score: number;
  matchedTerms: string[];
  matchedFields: AgentSkillSelectionMatchedField[];
}

export interface AgentSkillSelectionMatchedField {
  term: string;
  fields: string[];
}

export class AgentSkillSelector {
  private readonly tokenizer = new AgentToolSearchTokenizer();

  select(options: { query: string; skills: readonly RegisteredSkill[] }): AgentSkillSelectionResult[] {
    const query = options.query.trim();
    if (!query || options.skills.length === 0) {
      return [];
    }

    const docs = options.skills.map((skill) => this.buildDocument(skill));
    const docsById = new Map(docs.map((doc) => [doc.id, doc]));
    const skillsByName = new Map(options.skills.map((skill) => [skill.name, skill]));
    const index = new MiniSearch<SkillSearchDocument>({
      idField: "id",
      fields: [
        "skillName",
        "title",
        "pluginName",
        "tags",
        "summary",
        "useCases",
        "examples",
        "capabilityText",
        "capabilityFacets",
        "capabilityRiskText",
        "recommendedTools",
      ],
      storeFields: ["id", "skillName"],
      tokenize: (text) => this.tokenizer.tokenize(text),
      processTerm: (term) => term,
    });
    index.addAll(docs);

    const ranked = index
      .search(query)
      .map((result) => {
        const doc = docsById.get(String(result.id));
        const skill = doc ? skillsByName.get(doc.skillName) : undefined;
        return doc && skill
          ? {
              skill,
              score: result.score,
              matchedTerms: [...new Set(result.queryTerms)],
              matchedFields: Object.entries(result.match).map(([term, fields]) => ({
                term,
                fields: [...new Set(fields)],
              })),
            }
          : undefined;
      })
      .filter((result): result is AgentSkillSelectionResult => Boolean(result))
      .sort((left, right) => right.score - left.score || this.compareSkillOrder(left.skill, right.skill));

    return this.evidenceFrontier(ranked);
  }

  private buildDocument(skill: RegisteredSkill): SkillSearchDocument {
    const search = skill.search;
    const capabilities = search?.Capabilities ?? [];
    const capabilityText = capabilities
      .map((capability) =>
        capabilitySearchText(capability, {
          includeRisk: false,
        }),
      )
      .join(" ");
    const capabilityFacets = capabilities
      .flatMap((capability) => capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values))
      .join(" ");
    const capabilityRiskDocumentText = capabilities.map((capability) => capabilityRiskText(capability.Risk)).join(" ");
    const tags = (search?.Tags ?? []).join(" ");
    const summary = search?.Summary ?? skill.plugin.manifest.Plugin.Description ?? "";
    const useCases = (search?.UseCases ?? []).join(" ");
    const examples = (search?.Examples ?? []).join(" ");
    const avoid = (search?.Avoid ?? []).join(" ");
    const recommendedTools = skill.recommendedTools.join(" ");
    const title = skill.title ?? search?.Summary ?? skill.name;
    return {
      id: stableSkillDocumentId(skill),
      skillName: skill.name,
      title,
      pluginName: skill.plugin.manifest.Plugin.Name,
      tags,
      summary,
      useCases,
      examples,
      avoid,
      capabilityText,
      capabilityFacets,
      capabilityRiskText: capabilityRiskDocumentText,
      recommendedTools,
    };
  }

  private compareSkillOrder(left: RegisteredSkill, right: RegisteredSkill): number {
    return compareLoadedPluginsForPrompting(left.plugin, right.plugin) || left.name.localeCompare(right.name);
  }

  private evidenceFrontier(ranked: readonly AgentSkillSelectionResult[]): AgentSkillSelectionResult[] {
    const termSets = new Map(ranked.map((result) => [result.skill.name, new Set(result.matchedTerms)]));

    return ranked.filter((candidate) => {
      const candidateTerms = termSets.get(candidate.skill.name) ?? new Set<string>();
      return !ranked.some(
        (other) =>
          other.skill.name !== candidate.skill.name &&
          other.score >= candidate.score &&
          isStrictSuperset(termSets.get(other.skill.name) ?? new Set<string>(), candidateTerms),
      );
    });
  }
}

function stableSkillDocumentId(skill: RegisteredSkill): string {
  return crypto.createHash("sha1").update(`${skill.plugin.manifest.Plugin.Name}:${skill.name}`).digest("hex");
}

function isStrictSuperset(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size <= right.size) {
    return false;
  }
  for (const item of right) {
    if (!left.has(item)) {
      return false;
    }
  }
  return true;
}
