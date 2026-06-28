import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { ToolSearchCapabilityManifest } from "../Types/PluginManifestTypes.js";
import type { RegisteredAgentWorkflow } from "../Types/PluginRuntimeTypes.js";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import {
  capabilityFacetEntries,
  capabilitySearchText,
} from "../ToolSearch/AgentToolSearchCapabilities.js";
import MiniSearch from "minisearch";
import { compareLoadedPluginsForPrompting } from "../Plugin/AgentPluginOrdering.js";

interface AgentWorkflowSearchDocument {
  name: string;
  pluginName: string;
  title: string;
  description: string;
  triggerSkills: string;
  triggerAgents: string;
  tags: string;
  summary: string;
  useCases: string;
  examples: string;
  capabilities: string;
  capabilityFacets: string;
}

export interface AgentWorkflowSelectionResult {
  workflow: RegisteredAgentWorkflow;
  matchedSkills: string[];
  matchedAgents: string[];
  matchedTerms: string[];
  sources: AgentWorkflowSelectionSource[];
}

export type AgentWorkflowSelectionSource =
  | "skill-recommendation"
  | "skill-trigger"
  | "agent-trigger"
  | "search";

export class AgentWorkflowSelector {
  private readonly tokenizer = new AgentToolSearchTokenizer();

  constructor(private readonly registry: AgentPluginRegistry) {}

  select(options: {
    input: string;
    activeSkills: readonly AgentActivatedSkill[];
  }): AgentWorkflowSelectionResult[] {
    const workflows = this.registry.listAgentWorkflows();
    const activeSkillNames = new Set(options.activeSkills.map((skill) => skill.name));
    const recommendedWorkflowNames = new Set(
      options.activeSkills.flatMap((skill) => skill.recommendedWorkflows),
    );
    const recommendedAgentNames = new Set(
      options.activeSkills.flatMap((skill) => skill.recommendedAgents),
    );
    const selections = new Map<string, AgentWorkflowSelectionResult>();

    for (const workflow of workflows) {
      const matchedSkills = (workflow.trigger.Skills ?? []).filter((skill) =>
        activeSkillNames.has(skill));
      const matchedAgents = (workflow.trigger.Agents ?? []).filter((agent) =>
        recommendedAgentNames.has(agent));

      if (recommendedWorkflowNames.has(workflow.name)) {
        this.upsertSelection(selections, workflow, {
          matchedSkills,
          matchedAgents,
          matchedTerms: [],
          source: "skill-recommendation",
        });
      }
      if (matchedSkills.length > 0) {
        this.upsertSelection(selections, workflow, {
          matchedSkills,
          matchedAgents,
          matchedTerms: [],
          source: "skill-trigger",
        });
      }
      if (matchedAgents.length > 0) {
        this.upsertSelection(selections, workflow, {
          matchedSkills,
          matchedAgents,
          matchedTerms: [],
          source: "agent-trigger",
        });
      }
    }

    for (const result of this.search(options.input, workflows)) {
      this.upsertSelection(selections, result.workflow, {
        matchedSkills: (result.workflow.trigger.Skills ?? []).filter((skill) =>
          activeSkillNames.has(skill)),
        matchedAgents: (result.workflow.trigger.Agents ?? []).filter((agent) =>
          recommendedAgentNames.has(agent)),
        matchedTerms: result.matchedTerms,
        source: "search",
      });
    }

    return [...selections.values()].sort((left, right) =>
      compareLoadedPluginsForPrompting(left.workflow.plugin, right.workflow.plugin)
      || left.workflow.name.localeCompare(right.workflow.name));
  }

  private search(
    input: string,
    workflows: readonly RegisteredAgentWorkflow[],
  ): AgentWorkflowSelectionResult[] {
    const query = input.trim();
    if (!query) {
      return [];
    }

    const searchableWorkflows = workflows.filter((workflow) => Boolean(workflow.search));
    if (searchableWorkflows.length === 0) {
      return [];
    }

    const docs = searchableWorkflows.map((workflow) => this.buildDocument(workflow));
    const workflowsByName = new Map(searchableWorkflows.map((workflow) => [workflow.name, workflow]));
    const index = new MiniSearch<AgentWorkflowSearchDocument>({
      idField: "name",
      fields: [
        "name",
        "pluginName",
        "title",
        "description",
        "triggerSkills",
        "triggerAgents",
        "tags",
        "summary",
        "useCases",
        "examples",
        "capabilities",
        "capabilityFacets",
      ],
      storeFields: ["name"],
      tokenize: (text) => this.tokenizer.tokenize(text),
      processTerm: (term) => term,
    });
    index.addAll(docs);

    return index.search(query).flatMap((result) => {
      const workflow = workflowsByName.get(String(result.id));
      return workflow
        ? [{
            workflow,
            matchedSkills: [],
            matchedAgents: [],
            matchedTerms: [...new Set(result.queryTerms)],
            sources: ["search"],
          }]
        : [];
    });
  }

  private buildDocument(workflow: RegisteredAgentWorkflow): AgentWorkflowSearchDocument {
    const search = workflow.search;
    const triggerCapabilities = workflow.trigger.Capabilities ?? [];
    const searchCapabilities = search?.Capabilities ?? [];
    const capabilities = [...triggerCapabilities, ...searchCapabilities];

    return {
      name: workflow.name,
      pluginName: workflow.plugin.manifest.Plugin.Name,
      title: workflow.title ?? "",
      description: workflow.description ?? "",
      triggerSkills: (workflow.trigger.Skills ?? []).join(" "),
      triggerAgents: (workflow.trigger.Agents ?? []).join(" "),
      tags: (search?.Tags ?? []).join(" "),
      summary: search?.Summary ?? "",
      useCases: (search?.UseCases ?? []).join(" "),
      examples: (search?.Examples ?? []).join(" "),
      capabilities: capabilities.map(workflowCapabilitySearchText).join(" "),
      capabilityFacets: capabilities.flatMap((capability) =>
        capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values)).join(" "),
    };
  }

  private upsertSelection(
    selections: Map<string, AgentWorkflowSelectionResult>,
    workflow: RegisteredAgentWorkflow,
    patch: {
      matchedSkills: readonly string[];
      matchedAgents: readonly string[];
      matchedTerms: readonly string[];
      source: AgentWorkflowSelectionSource;
    },
  ): void {
    const current = selections.get(workflow.name);
    if (!current) {
      selections.set(workflow.name, {
        workflow,
        matchedSkills: [...new Set(patch.matchedSkills)],
        matchedAgents: [...new Set(patch.matchedAgents)],
        matchedTerms: [...new Set(patch.matchedTerms)],
        sources: [patch.source],
      });
      return;
    }

    current.matchedSkills = [...new Set([...current.matchedSkills, ...patch.matchedSkills])];
    current.matchedAgents = [...new Set([...current.matchedAgents, ...patch.matchedAgents])];
    current.matchedTerms = [...new Set([...current.matchedTerms, ...patch.matchedTerms])];
    current.sources = [...new Set([...current.sources, patch.source])];
  }
}

function workflowCapabilitySearchText(capability: ToolSearchCapabilityManifest): string {
  return capabilitySearchText(capability, {
    includeRisk: false,
  });
}
