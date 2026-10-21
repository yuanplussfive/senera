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
import {
  AgentSkillInvocationRegistry,
  isAgentSkillModelInvocable,
  parseAgentSkillInvocations,
} from "./AgentSkillInvocation.js";
import type { AgentSkillSelectionResult, AgentSkillSelectionScenarioEvidence } from "./AgentSkillSelector.js";
import type { RegisteredSkill } from "./AgentSkillTypes.js";
import { partitionAgentToolsByInvocationRoute } from "../ToolRuntime/AgentToolInvocationRouting.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import {
  normalizeAgentExplicitActivations,
  type AgentExplicitActivationReference,
} from "../Activation/AgentActivationTypes.js";

export interface AgentActivatedSkill {
  name: string;
  revision: string;
  title: string;
  summary: string;
  useCases: string[];
  avoid: string[];
  recommendedTools: string[];
  disableModelInvocation?: boolean;
  evidenceRequirements: SkillEvidenceRequirementManifest[];
  descriptionFile: string;
  /** Body from the selected revision, retained for the whole turn. */
  readonly content: string;
  matchedTerms: string[];
  matchedFields: AgentActivatedSkillMatchedField[];
  score: number;
}

export interface AgentPinnedSkillReference {
  readonly name: string;
  readonly revision: string;
}

export interface AgentActivatedSkillMatchedField {
  term: string;
  fields: string[];
}

export interface AgentSkillRecommendedToolRouting {
  readonly directToolNames: readonly string[];
  readonly dynamicToolNames: readonly string[];
  /** Dynamic tools selected by an explicit activation for this turn. */
  readonly nativeToolNames: readonly string[];
  /**
   * Tools belonging to an explicitly selected activation. These are loaded
   * from the live registry for this turn; semantically selected Skills remain
   * discovery-first and do not populate this set.
   */
  readonly requiredToolNames: readonly string[];
}

export interface AgentSkillRoutingEvidenceProvider {
  skillScenarioEvidence(options: {
    query: string;
    skills: readonly RegisteredSkill[];
  }): readonly AgentSkillSelectionScenarioEvidence[] | Promise<readonly AgentSkillSelectionScenarioEvidence[]>;
  selectSkills?(options: {
    query: string;
    skills: readonly RegisteredSkill[];
    signal?: AbortSignal;
  }): Promise<AgentSkillSelectionResult[]>;
}

export const AgentSkillActivationScores = {
  ExplicitInvocation: Number.MAX_SAFE_INTEGER,
  PinnedConfiguration: Number.MAX_SAFE_INTEGER - 1,
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
    /** Tools already exposed for this turn, used as retrieval evidence only. */
    availableToolNames?: readonly string[];
    decision?: AgentActionDecision;
    rootCommand?: AgentRootCommand | null;
    pinnedSkills?: readonly AgentPinnedSkillReference[];
    explicitActivations?: readonly AgentExplicitActivationReference[];
    signal?: AbortSignal;
  }): Promise<AgentActivatedSkill[]> {
    const query = this.buildActivationQuery(options);
    const catalogByName = new Map(this.projector.list().map((skill) => [skill.name, skill]));
    const skills = this.registry.listSkills();
    const routableSkills = skills.filter(isAgentSkillModelInvocable);
    const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
    const invocationRegistry = new AgentSkillInvocationRegistry(skills);
    const pinnedReferences = uniquePinnedSkillReferences(options.pinnedSkills ?? []);
    const pinnedNames = pinnedReferences.map((reference) => reference.name);
    const missingPinnedNames = pinnedNames.filter((name) => !skillsByName.has(name));
    if (missingPinnedNames.length > 0) {
      throw new Error(`Pinned Skills are not registered: ${missingPinnedNames.join(", ")}.`);
    }
    const changedPinnedSkills = pinnedReferences.flatMap((reference) => {
      const skill = skillsByName.get(reference.name)!;
      const activeRevision = skill.revision ?? skill.source.id;
      return activeRevision === reference.revision
        ? []
        : [`${reference.name} (selected ${reference.revision}, active ${activeRevision})`];
    });
    if (changedPinnedSkills.length > 0) {
      throw new Error(`Pinned Skill revisions changed before activation: ${changedPinnedSkills.join(", ")}.`);
    }
    const pinnedNameSet = new Set(pinnedNames);
    const pinned = pinnedNames.map((name): AgentSkillSelectionResult => ({
      skill: skillsByName.get(name)!,
      score: AgentSkillActivationScores.PinnedConfiguration,
      matchedTerms: [name],
      matchedFields: [{ term: name, fields: ["pinnedConfiguration"] }],
    }));
    const parsedInvocations = parseAgentSkillInvocations(options.input);
    const missingInvocations = parsedInvocations.filter((invocation) => !invocationRegistry.resolve(invocation.name));
    if (missingInvocations.length > 0) {
      throw new Error(
        `Explicit Skill commands are not registered: ${missingInvocations.map((invocation) => invocation.token).join(", ")}.`,
      );
    }
    const explicitInvocations = new Map(parsedInvocations.map((invocation) => [invocation.name, invocation]));
    const explicitNames = new Set(explicitInvocations.keys());
    const explicit = skills
      .filter((skill) => explicitNames.has(skill.name) && !pinnedNameSet.has(skill.name))
      .map((skill): AgentSkillSelectionResult => {
        const invocation = explicitInvocations.get(skill.name);
        const token = invocation?.token ?? `/${skill.name}`;
        return {
          skill,
          score: AgentSkillActivationScores.ExplicitInvocation,
          matchedTerms: [token],
          matchedFields: [{ term: token, fields: ["explicitInvocation"] }],
        };
      });
    const structured = normalizeAgentExplicitActivations(
      options.explicitActivations ? { catalogRevision: "runtime", explicit: options.explicitActivations } : undefined,
    );
    const structuredExplicitSkills = new Map<string, AgentExplicitActivationReference>();
    const structuredPluginIds = new Set<string>();
    const structuredSystemIds = new Set<string>();
    for (const activation of structured?.explicit ?? []) {
      if (activation.kind === "skill") {
        const skill = skillsByName.get(activation.id);
        if (!skill) throw new Error(`Explicit Skill is not registered: ${activation.id}.`);
        const activeRevision = skill.revision ?? skill.source.id;
        if (activeRevision !== activation.revision) {
          throw new Error(
            `Explicit Skill revision changed before activation: ${activation.id} (selected ${activation.revision}, active ${activeRevision}).`,
          );
        }
        structuredExplicitSkills.set(activation.id, activation);
        continue;
      }
      if (activation.kind === "mcp") {
        const mcpTools = this.registry.listToolsForOwnerName("mcp", activation.id);
        if (mcpTools.length === 0) {
          throw new Error(`Explicit MCP is not loaded or has no registered capabilities: ${activation.id}.`);
        }
        continue;
      }
      if (activation.kind === "system") {
        const systemSkills = skills.filter(
          (skill) => skill.source.kind === "system" && skill.source.id === activation.id,
        );
        const systemTools = this.registry.listToolsForOwnerName("system", activation.id);
        if (systemSkills.length === 0 && systemTools.length === 0) {
          throw new Error(
            `Explicit System extension is not loaded or has no registered capabilities: ${activation.id}.`,
          );
        }
        structuredSystemIds.add(activation.id);
        continue;
      }
      const pluginSkills = skills.filter(
        (skill) => skill.source.kind === "standalone" && skill.source.id === `plugin:${activation.id}`,
      );
      const pluginTools = this.registry.listToolsForOwnerName("plugin", activation.id);
      if (pluginSkills.length === 0 && pluginTools.length === 0) {
        throw new Error(`Explicit Plugin is not loaded or has no registered capabilities: ${activation.id}.`);
      }
      structuredPluginIds.add(activation.id);
    }
    const structuredExplicit = skills
      .filter(
        (skill) =>
          (structuredExplicitSkills.has(skill.name) ||
            [...structuredPluginIds].some(
              (pluginId) => skill.source.kind === "standalone" && skill.source.id === `plugin:${pluginId}`,
            ) ||
            [...structuredSystemIds].some(
              (extensionId) => skill.source.kind === "system" && skill.source.id === extensionId,
            )) &&
          !pinnedNameSet.has(skill.name),
      )
      .map((skill): AgentSkillSelectionResult => ({
        skill,
        score: AgentSkillActivationScores.ExplicitInvocation,
        matchedTerms: [`@${skill.name}`],
        matchedFields: [{ term: `@${skill.name}`, fields: ["explicitActivation"] }],
      }));
    const selected = this.routingEvidence?.selectSkills
      ? await this.routingEvidence.selectSkills({ query, skills: routableSkills, signal: options.signal })
      : this.selector.select({
          query,
          skills: routableSkills,
          scenarioEvidence: await this.routingEvidence?.skillScenarioEvidence({ query, skills: routableSkills }),
        });

    return [
      ...pinned,
      ...explicit,
      ...structuredExplicit.filter((item) => !explicitNames.has(item.skill.name)),
      ...selected.filter(
        (item) =>
          !pinnedNameSet.has(item.skill.name) &&
          !explicitNames.has(item.skill.name) &&
          !structuredExplicit.some((explicitItem) => explicitItem.skill.name === item.skill.name),
      ),
    ].map((item) => {
      const catalog = catalogByName.get(item.skill.name) ?? this.projector.project(item.skill);
      return {
        name: item.skill.name,
        revision: item.skill.revision ?? item.skill.source.id,
        title: catalog.title,
        summary: catalog.summary,
        useCases: catalog.useCases,
        avoid: catalog.avoid,
        recommendedTools: this.registry.filterAvailableToolNames(item.skill.recommendedTools),
        ...(item.skill.disableModelInvocation === true ? { disableModelInvocation: true } : {}),
        evidenceRequirements: item.skill.evidenceRequirements,
        descriptionFile: item.skill.descriptionFile,
        content: item.skill.content,
        matchedTerms: item.matchedTerms,
        matchedFields: item.matchedFields,
        score: item.score,
      };
    });
  }

  recommendedToolRouting(
    skills: readonly AgentActivatedSkill[],
    explicitActivations: readonly AgentExplicitActivationReference[] = [],
  ): AgentSkillRecommendedToolRouting {
    const toolsByName = new Map<string, RegisteredTool>();
    const requiredToolNames = new Set<string>();
    const registeredSkillsByName = new Map(this.registry.listSkills().map((skill) => [skill.name, skill]));
    const explicitSkillNames = new Set(
      explicitActivations.filter((activation) => activation.kind === "skill").map((activation) => activation.id),
    );
    for (const toolName of skills.flatMap((skill) => skill.recommendedTools)) {
      if (toolsByName.has(toolName)) continue;
      const tool = this.registry.getTool(toolName);
      if (tool) toolsByName.set(toolName, tool);
    }
    for (const skillName of explicitSkillNames) {
      for (const toolName of registeredSkillsByName.get(skillName)?.recommendedTools ?? []) {
        requiredToolNames.add(toolName);
      }
    }
    for (const activation of explicitActivations) {
      if (activation.kind !== "plugin" && activation.kind !== "mcp" && activation.kind !== "system") continue;
      const tools = this.registry.listToolsForOwnerName(activation.kind, activation.id);
      if (tools.length === 0) {
        throw new Error(
          `Explicit ${activation.kind} is not loaded or has no registered capabilities: ${activation.id}.`,
        );
      }
      for (const tool of tools) {
        if (!toolsByName.has(tool.name)) toolsByName.set(tool.name, tool);
        requiredToolNames.add(tool.name);
      }
    }
    const partition = partitionAgentToolsByInvocationRoute([...toolsByName.values()]);
    const requiredToolNameSet = new Set(requiredToolNames);
    return {
      directToolNames: partition.direct.map((tool) => tool.name),
      dynamicToolNames: partition.discovery.map((tool) => tool.name),
      nativeToolNames: partition.discovery
        .filter((tool) => requiredToolNameSet.has(tool.name))
        .map((tool) => tool.name),
      requiredToolNames: [...requiredToolNames],
    };
  }

  private buildActivationQuery(options: {
    input?: string;
    availableToolNames?: readonly string[];
    decision?: AgentActionDecision;
    rootCommand?: AgentRootCommand | null;
  }): string {
    return [
      ...new Set(
        [
          options.input,
          ...this.availableToolQuerySegments(options.availableToolNames),
          ...this.decisionQuerySegments(options.decision),
          ...this.rootCommandQuerySegments(options.rootCommand),
        ].filter((segment): segment is string => Boolean(segment)),
      ),
    ].join("\n");
  }

  private availableToolQuerySegments(toolNames: readonly string[] | undefined): string[] {
    const names = [...new Set((toolNames ?? []).map((name) => name.trim()).filter(Boolean))];
    return names.length > 0 ? [`available tools: ${names.join(", ")}`] : [];
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

function uniquePinnedSkillReferences(references: readonly AgentPinnedSkillReference[]): AgentPinnedSkillReference[] {
  const unique = new Map<string, AgentPinnedSkillReference>();
  for (const reference of references) {
    const previous = unique.get(reference.name);
    if (previous && previous.revision !== reference.revision) {
      throw new Error(
        `Pinned Skill ${reference.name} has conflicting revisions: ${previous.revision}, ${reference.revision}.`,
      );
    }
    unique.set(reference.name, reference);
  }
  return [...unique.values()];
}
