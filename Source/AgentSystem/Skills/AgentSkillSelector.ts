import type { RegisteredSkill } from "./AgentSkillTypes.js";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import { AgentCapabilityKinds, AgentCapabilitySearchIndex } from "../ToolSearch/AgentCapabilitySearchIndex.js";
import { buildSkillCapabilityDocument } from "../ToolSearch/AgentCapabilityDocumentBuilder.js";

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

export interface AgentSkillSelectionScenarioEvidence {
  skillName: string;
  skillRevision: string;
  rankScore: number;
  terms: readonly string[];
}

export class AgentSkillSelector {
  private readonly tokenizer = new AgentToolSearchTokenizer();

  constructor(private readonly capabilityIndex?: AgentCapabilitySearchIndex) {}

  select(options: {
    query: string;
    skills: readonly RegisteredSkill[];
    scenarioEvidence?: readonly AgentSkillSelectionScenarioEvidence[];
  }): AgentSkillSelectionResult[] {
    const skillsByName = new Map(options.skills.map((skill) => [skill.name, skill]));
    const lexical = this.selectLexical(options.query, options.skills, skillsByName);
    const ranked = this.mergeScenarioEvidence(lexical, skillsByName, options.scenarioEvidence ?? []).sort(
      (left, right) => right.score - left.score || this.compareSkillOrder(left.skill, right.skill),
    );

    return this.evidenceFrontier(ranked);
  }

  async selectHybrid(options: {
    query: string;
    skills: readonly RegisteredSkill[];
    scenarioEvidence?: readonly AgentSkillSelectionScenarioEvidence[];
    signal?: AbortSignal;
  }): Promise<AgentSkillSelectionResult[]> {
    if (!this.capabilityIndex || options.skills.length === 0 || options.query.trim().length === 0) {
      return this.select(options);
    }

    const skillsByName = new Map(options.skills.map((skill) => [skill.name, skill]));
    const lexical = this.selectLexical(options.query, options.skills, skillsByName);
    const semantic = await this.capabilityIndex.semantic(
      options.query,
      AgentCapabilityKinds.Skill,
      new Set(skillsByName.keys()),
      options.signal,
    );
    const merged = new Map(lexical.map((selection) => [selection.skill.name, selection]));
    semantic.forEach((match, rank) => {
      const skill = skillsByName.get(match.name);
      if (!skill) return;
      const current = merged.get(match.name);
      const semanticScore = reciprocalPosition(rank);
      merged.set(match.name, {
        skill,
        score: (current?.score ?? 0) + semanticScore,
        matchedTerms: current?.matchedTerms ?? [],
        matchedFields: mergeMatchedFields([
          ...(current?.matchedFields ?? []),
          { term: options.query, fields: ["semanticEmbedding"] },
        ]),
      });
    });
    const scenarioRanked = this.mergeScenarioEvidence([...merged.values()], skillsByName, options.scenarioEvidence ?? []);
    return this.evidenceFrontier(
      [...scenarioRanked].sort(
        (left, right) => right.score - left.score || this.compareSkillOrder(left.skill, right.skill),
      ),
    );
  }

  private selectLexical(
    queryInput: string,
    skills: readonly RegisteredSkill[],
    skillsByName: ReadonlyMap<string, RegisteredSkill>,
  ): AgentSkillSelectionResult[] {
    const query = queryInput.trim();
    if (!query || skills.length === 0) return [];

    const index = this.capabilityIndex ?? this.createCapabilityIndex(skills);
    return index
      .lexical(query, AgentCapabilityKinds.Skill, new Set(skillsByName.keys()))
      .map((result) => {
        const skill = skillsByName.get(result.name);
        return skill
          ? {
              skill,
              score: result.score,
              matchedTerms: [...new Set(result.queryTerms)],
              matchedFields: Object.entries(result.matchedFields).map(([term, fields]) => ({
                term,
                fields: [...new Set(fields)],
              })),
            }
          : undefined;
      })
      .filter((result): result is AgentSkillSelectionResult => Boolean(result));
  }

  private mergeScenarioEvidence(
    semantic: readonly AgentSkillSelectionResult[],
    skillsByName: ReadonlyMap<string, RegisteredSkill>,
    evidence: readonly AgentSkillSelectionScenarioEvidence[],
  ): AgentSkillSelectionResult[] {
    const merged = new Map(semantic.map((result) => [result.skill.name, result]));
    for (const scenario of evidence) {
      const skill = skillsByName.get(scenario.skillName);
      if (!skill || scenario.skillRevision !== (skill.revision ?? skill.source.id) || scenario.rankScore <= 0) continue;
      const current = merged.get(skill.name);
      if (!current) continue;
      const scenarioMatches = scenario.terms.map((term) => ({ term, fields: ["completedScenario"] }));
      merged.set(skill.name, {
        skill,
        score: current.score + scenario.rankScore,
        matchedTerms: [...new Set([...current.matchedTerms, ...scenario.terms])],
        matchedFields: mergeMatchedFields([...current.matchedFields, ...scenarioMatches]),
      });
    }
    return [...merged.values()];
  }

  private createCapabilityIndex(skills: readonly RegisteredSkill[]): AgentCapabilitySearchIndex {
    return new AgentCapabilitySearchIndex(skills.map(buildSkillCapabilityDocument), { tokenizer: this.tokenizer });
  }

  private compareSkillOrder(left: RegisteredSkill, right: RegisteredSkill): number {
    return (
      compareOptionalAscending(left.source.priority, right.source.priority) ||
      left.source.id.localeCompare(right.source.id) ||
      left.name.localeCompare(right.name)
    );
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

function mergeMatchedFields(values: readonly AgentSkillSelectionMatchedField[]): AgentSkillSelectionMatchedField[] {
  const fieldsByTerm = new Map<string, Set<string>>();
  for (const value of values) {
    const fields = fieldsByTerm.get(value.term) ?? new Set<string>();
    for (const field of value.fields) fields.add(field);
    fieldsByTerm.set(value.term, fields);
  }
  return [...fieldsByTerm].map(([term, fields]) => ({ term, fields: [...fields] }));
}

function compareOptionalAscending(left: number | undefined, right: number | undefined): number {
  if (left !== undefined && right !== undefined) return left - right;
  if (left !== undefined) return -1;
  if (right !== undefined) return 1;
  return 0;
}

function reciprocalPosition(index: number): number {
  return 1 / (index + 1);
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
