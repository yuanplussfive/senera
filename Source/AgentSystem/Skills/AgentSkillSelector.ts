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

export interface AgentSkillSelectionLearningEvidence {
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
    learningEvidence?: readonly AgentSkillSelectionLearningEvidence[];
  }): AgentSkillSelectionResult[] {
    const skillsByName = new Map(options.skills.map((skill) => [skill.name, skill]));
    const lexical = this.selectLexical(options.query, options.skills, skillsByName);
    const ranked = this.mergeLearningEvidence(lexical, skillsByName, options.learningEvidence ?? []).sort(
      (left, right) => right.score - left.score || this.compareSkillOrder(left.skill, right.skill),
    );

    return this.evidenceFrontier(ranked);
  }

  async selectHybrid(options: {
    query: string;
    skills: readonly RegisteredSkill[];
    learningEvidence?: readonly AgentSkillSelectionLearningEvidence[];
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
    const learned = this.mergeLearningEvidence([...merged.values()], skillsByName, options.learningEvidence ?? []);
    const reranked = await this.capabilityIndex.rerank(
      options.query,
      AgentCapabilityKinds.Skill,
      learned.map((selection) => selection.skill.name),
      options.signal,
    );
    const rerankBySkill = new Map(reranked.map((entry) => [entry.name, entry]));
    return this.evidenceFrontier(
      learned
        .map((selection) => {
          const rerank = rerankBySkill.get(selection.skill.name);
          return rerank
            ? {
                ...selection,
                score: selection.score + rerank.normalizedRankScore,
                matchedFields: mergeMatchedFields([
                  ...selection.matchedFields,
                  { term: options.query, fields: ["semanticRerank"] },
                ]),
              }
            : selection;
        })
        .sort((left, right) => right.score - left.score || this.compareSkillOrder(left.skill, right.skill)),
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

  private mergeLearningEvidence(
    semantic: readonly AgentSkillSelectionResult[],
    skillsByName: ReadonlyMap<string, RegisteredSkill>,
    evidence: readonly AgentSkillSelectionLearningEvidence[],
  ): AgentSkillSelectionResult[] {
    const merged = new Map(semantic.map((result) => [result.skill.name, result]));
    for (const learned of evidence) {
      const skill = skillsByName.get(learned.skillName);
      if (!skill || learned.skillRevision !== (skill.revision ?? skill.source.id) || learned.rankScore <= 0) continue;
      const current = merged.get(skill.name);
      if (!current) continue;
      const learnedMatches = learned.terms.map((term) => ({ term, fields: ["learnedUsage"] }));
      merged.set(skill.name, {
        skill,
        score: current.score + learned.rankScore,
        matchedTerms: [...new Set([...current.matchedTerms, ...learned.terms])],
        matchedFields: mergeMatchedFields([...current.matchedFields, ...learnedMatches]),
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
