import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { SkillEvidenceRequirementManifest } from "../Types/PluginManifestTypes.js";
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

export interface AgentActivatedSkill {
  name: string;
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

export class AgentSkillActivationService {
  private readonly selector = new AgentSkillSelector();
  private readonly projector: AgentSkillCatalogProjector;

  constructor(private readonly registry: AgentPluginRegistry) {
    this.projector = new AgentSkillCatalogProjector(registry);
  }

  activate(options: {
    input?: string;
    decision?: AgentActionDecision;
    rootCommand?: AgentRootCommand | null;
  }): AgentActivatedSkill[] {
    const query = this.buildActivationQuery(options);
    const catalogByName = new Map(this.projector.list().map((skill) => [skill.name, skill]));

    return this.selector
      .select({
        query,
        skills: this.registry.listSkills(),
      })
      .map((selection) => {
        const catalog = catalogByName.get(selection.skill.name) ?? this.projector.project(selection.skill);
        return {
          name: selection.skill.name,
          title: catalog.title,
          summary: catalog.summary,
          useCases: catalog.useCases,
          avoid: catalog.avoid,
          recommendedTools: this.registry.filterAvailableToolNames(selection.skill.recommendedTools),
          evidenceRequirements: selection.skill.evidenceRequirements,
          descriptionFile: selection.skill.descriptionFile,
          matchedTerms: selection.matchedTerms,
          matchedFields: selection.matchedFields,
          score: selection.score,
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
      options.input,
      ...this.decisionQuerySegments(options.decision),
      ...this.rootCommandQuerySegments(options.rootCommand),
    ]
      .filter(Boolean)
      .join("\n");
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
      ...rootCommand.preferredTools,
      ...rootCommand.toolSearchQueries,
      ...rootCommand.allowedTools,
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
