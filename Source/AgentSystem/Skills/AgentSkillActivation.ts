import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { SkillEvidenceRequirementManifest } from "./AgentSkillTypes.js";
import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionDecision,
} from "../ActionPlanner/AgentActionPlannerTypes.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import { AgentSkillCatalogProjector } from "./AgentSkillCatalogProjector.js";
import { AgentSkillSelector } from "./AgentSkillSelector.js";
import { parseAgentExplicitSkillNames } from "./AgentSkillInvocation.js";
import type { AgentSkillSelectionLearningEvidence, AgentSkillSelectionResult } from "./AgentSkillSelector.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";

export interface AgentActivatedSkill {
  name: string;
  revision: string;
  title: string;
  summary: string;
  useCases: string[];
  avoid: string[];
  recommendedTools: string[];
  evidenceRequirements: SkillEvidenceRequirementManifest[];
  descriptionFile: string;
  matchedTerms: string[];
  matchedFields: AgentActivatedSkillMatchedField[];
  score: number;
}

export interface AgentActivatedSkillMatchedField {
  term: string;
  fields: string[];
}

export interface AgentSkillRoutingEvidenceProvider {
  skillRoutingEvidence(options: {
    query: string;
    skills: readonly RegisteredSkill[];
  }): readonly AgentSkillSelectionLearningEvidence[];
  selectSkills?(options: {
    query: string;
    skills: readonly RegisteredSkill[];
    signal?: AbortSignal;
  }): Promise<AgentSkillSelectionResult[]>;
}

export const AgentSkillActivationScores = {
  ExplicitInvocation: Number.MAX_SAFE_INTEGER,
} as const;

export class AgentSkillActivationService {
  private readonly selector = new AgentSkillSelector();
  private readonly projector: AgentSkillCatalogProjector;

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly routingEvidence?: AgentSkillRoutingEvidenceProvider,
  ) {
    this.projector = new AgentSkillCatalogProjector(registry);
  }

  async activate(options: {
    input?: string;
    decision?: AgentActionDecision;
    rootCommand?: AgentRootCommand | null;
    signal?: AbortSignal;
  }): Promise<AgentActivatedSkill[]> {
    const query = this.buildActivationQuery(options);
    const catalogByName = new Map(this.projector.list().map((skill) => [skill.name, skill]));
    const skills = this.registry.listSkills();
    const explicitNames = new Set(parseAgentExplicitSkillNames(options.input));
    const explicit = skills
      .filter((skill) => explicitNames.has(skill.name))
      .map((skill): AgentSkillSelectionResult => ({
        skill,
        score: AgentSkillActivationScores.ExplicitInvocation,
        matchedTerms: [`$${skill.name}`],
        matchedFields: [{ term: `$${skill.name}`, fields: ["explicitInvocation"] }],
      }));
    const selected = this.routingEvidence?.selectSkills
      ? await this.routingEvidence.selectSkills({ query, skills, signal: options.signal })
      : this.selector.select({
          query,
          skills,
          learningEvidence: this.routingEvidence?.skillRoutingEvidence({ query, skills }),
        });

    return [...explicit, ...selected.filter((item) => !explicitNames.has(item.skill.name))].map((item) => {
      const catalog = catalogByName.get(item.skill.name) ?? this.projector.project(item.skill);
      return {
        name: item.skill.name,
        revision: item.skill.revision ?? item.skill.source.id,
        title: catalog.title,
        summary: catalog.summary,
        useCases: catalog.useCases,
        avoid: catalog.avoid,
        recommendedTools: this.registry.filterAvailableToolNames(item.skill.recommendedTools),
        evidenceRequirements: item.skill.evidenceRequirements,
        descriptionFile: item.skill.descriptionFile,
        matchedTerms: item.matchedTerms,
        matchedFields: item.matchedFields,
        score: item.score,
      };
    });
  }

  recommendedToolNames(skills: readonly AgentActivatedSkill[]): string[] {
    return [...new Set(skills.flatMap((skill) => skill.recommendedTools))];
  }

  private buildActivationQuery(options: {
    input?: string;
    decision?: AgentActionDecision;
    rootCommand?: AgentRootCommand | null;
  }): string {
    return [
      ...new Set(
        [
          options.input,
          ...this.decisionQuerySegments(options.decision),
          ...this.rootCommandQuerySegments(options.rootCommand),
        ].filter((segment): segment is string => Boolean(segment)),
      ),
    ].join("\n");
  }

  private decisionQuerySegments(decision: AgentActionDecision | undefined): string[] {
    if (!decision) {
      return [];
    }

    return [
      decision.action,
      agentActionInstruction(decision),
      ...agentActionPreferredTools(decision),
      ...agentActionToolSearchQueries(decision),
      ...this.capabilityNeedSegments(agentActionCapabilityNeeds(decision)),
    ];
  }

  private rootCommandQuerySegments(rootCommand: AgentRootCommand | null | undefined): string[] {
    if (!rootCommand) {
      return [];
    }

    return [
      rootCommand.action,
      rootCommand.objective,
      ...(rootCommand.instruction ? [rootCommand.instruction] : []),
      ...rootCommand.toolAccessGrant.preferredToolNames,
      ...rootCommand.toolSearchQueries,
      ...this.capabilityNeedSegments(rootCommand.needs),
    ];
  }

  private capabilityNeedSegments(needs: readonly ReturnType<typeof agentActionCapabilityNeeds>[number][]): string[] {
    return needs.flatMap((need) => [
      ...need.actions,
      ...need.targets,
      ...need.inputs,
      ...need.outputs,
      ...need.evidence,
      ...need.effects,
    ]);
  }
}
