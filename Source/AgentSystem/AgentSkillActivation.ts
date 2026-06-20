import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { SkillEvidenceRequirementManifest } from "./Types.js";
import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionDecision,
} from "./AgentActionPlannerTypes.js";
import type { AgentRootCommand } from "./AgentRootCommand.js";
import { AgentSkillCatalogProjector } from "./AgentSkillCatalogProjector.js";
import { AgentSkillSelector } from "./AgentSkillSelector.js";

export interface AgentActivatedSkill {
  name: string;
  title: string;
  summary: string;
  useCases: string[];
  avoid: string[];
  recommendedTools: string[];
  recommendedAgents: string[];
  recommendedWorkflows: string[];
  evidenceRequirements: SkillEvidenceRequirementManifest[];
  descriptionFile: string;
  workflowFile?: string;
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
    const catalogByName = new Map(
      this.projector.list().map((skill) => [skill.name, skill]),
    );

    return this.selector
      .select({
        query,
        skills: this.registry.listSkills(),
      })
      .map((selection) => {
        const catalog = catalogByName.get(selection.skill.name)
          ?? this.projector.project(selection.skill);
        return {
          name: selection.skill.name,
          title: catalog.title,
          summary: catalog.summary,
          useCases: catalog.useCases,
          avoid: catalog.avoid,
          recommendedTools: selection.skill.recommendedTools,
          recommendedAgents: selection.skill.recommendedAgents,
          recommendedWorkflows: selection.skill.recommendedWorkflows,
          evidenceRequirements: selection.skill.evidenceRequirements,
          descriptionFile: selection.skill.descriptionFile,
          workflowFile: selection.skill.workflowFile,
          matchedTerms: selection.matchedTerms,
          matchedFields: selection.matchedFields,
          score: selection.score,
        };
      });
  }

  recommendedToolNames(skills: readonly AgentActivatedSkill[]): string[] {
    return [
      ...new Set(
        skills
          .flatMap((skill) => skill.recommendedTools)
          .filter((toolName) => Boolean(this.registry.getTool(toolName))),
      ),
    ];
  }

  recommendedAgentNames(skills: readonly AgentActivatedSkill[]): string[] {
    return [
      ...new Set(
        skills
          .flatMap((skill) => skill.recommendedAgents)
          .filter((agentName) => Boolean(this.registry.getAgent(agentName))),
      ),
    ];
  }

  recommendedWorkflowNames(skills: readonly AgentActivatedSkill[]): string[] {
    return [
      ...new Set(
        skills
          .flatMap((skill) => skill.recommendedWorkflows)
          .filter((workflowName) => Boolean(this.registry.getAgentWorkflow(workflowName))),
      ),
    ];
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
    ].filter(Boolean).join("\n");
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
      ...rootCommand.workflowRecommendedTools,
      ...rootCommand.workflowRecommendations.flatMap((workflow) => [
        workflow.name,
        workflow.title ?? "",
        workflow.description ?? "",
        ...workflow.sources,
        ...workflow.matchedSkills,
        ...workflow.matchedAgents,
        ...workflow.matchedTerms,
      ]),
      ...rootCommand.toolSearchQueries,
      ...rootCommand.allowedTools,
      ...this.capabilityNeedSegments(rootCommand.needs),
    ];
  }

  private capabilityNeedSegments(
    needs: readonly ReturnType<typeof agentActionCapabilityNeeds>[number][],
  ): string[] {
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
