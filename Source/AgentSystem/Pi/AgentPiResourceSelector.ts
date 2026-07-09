import crypto from "node:crypto";
import MiniSearch from "minisearch";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import {
  capabilityFacetEntries,
  capabilityRiskText,
  capabilitySearchText,
} from "../ToolSearch/AgentToolSearchCapabilities.js";
import type { RegisteredTemplate } from "../Types/PluginRuntimeTypes.js";

export interface AgentPiResourceSelectionInput {
  input?: string;
  turnUnderstanding?: TurnUnderstanding;
  rootCommand?: AgentRootCommand;
  activeSkills?: readonly AgentActivatedSkill[];
}

export interface AgentPiResourceSelection {
  promptTemplates: AgentPiSelectedPromptTemplate[];
}

export interface AgentPiSelectedPromptTemplate {
  template: RegisteredTemplate;
  score: number;
  matchedTerms: string[];
  resourceKinds: string[];
  workflowRoles: string[];
}

interface TemplateSearchDocument {
  id: string;
  templateName: string;
  pluginName: string;
  description: string;
  summary: string;
  tags: string;
  useCases: string;
  examples: string;
  avoid: string;
  capabilityText: string;
  capabilityFacets: string;
  capabilityRiskText: string;
}

export class AgentPiResourceSelector {
  private readonly tokenizer = new AgentToolSearchTokenizer();

  select(options: {
    input: AgentPiResourceSelectionInput;
    templates: readonly RegisteredTemplate[];
  }): AgentPiResourceSelection {
    const query = this.buildQuery(options.input).trim();
    const templates = options.templates.filter((template) => template.exposeToPi);
    if (!query || templates.length === 0) {
      return { promptTemplates: [] };
    }

    const documents = templates.map((template) => this.buildTemplateDocument(template));
    const documentById = new Map(documents.map((document) => [document.id, document]));
    const templateByName = new Map(templates.map((template) => [template.name, template]));
    const index = new MiniSearch<TemplateSearchDocument>({
      idField: "id",
      fields: [
        "templateName",
        "pluginName",
        "description",
        "summary",
        "tags",
        "useCases",
        "examples",
        "capabilityText",
        "capabilityFacets",
        "capabilityRiskText",
      ],
      storeFields: ["id", "templateName"],
      tokenize: (text) => this.tokenizer.tokenize(text),
      processTerm: (term) => term,
    });
    index.addAll(documents);

    return {
      promptTemplates: index
        .search(query)
        .flatMap((result) => {
          const document = documentById.get(String(result.id));
          const template = document ? templateByName.get(document.templateName) : undefined;
          return template
            ? [{
                template,
                score: result.score,
                matchedTerms: [...new Set(result.queryTerms)],
                resourceKinds: templateResourceMetadata(template, "PiResourceKind"),
                workflowRoles: templateResourceMetadata(template, "PiWorkflowRole"),
              }]
            : [];
        })
        .sort((left, right) =>
          right.score - left.score || left.template.name.localeCompare(right.template.name)),
    };
  }

  private buildTemplateDocument(template: RegisteredTemplate): TemplateSearchDocument {
    const search = template.search;
    const capabilities = search?.Capabilities ?? [];
    return {
      id: stableTemplateDocumentId(template),
      templateName: template.name,
      pluginName: template.plugin.manifest.Plugin.Name,
      description: template.description ?? "",
      summary: search?.Summary ?? "",
      tags: (search?.Tags ?? []).join(" "),
      useCases: (search?.UseCases ?? []).join(" "),
      examples: (search?.Examples ?? []).join(" "),
      avoid: (search?.Avoid ?? []).join(" "),
      capabilityText: capabilities
        .map((capability) => capabilitySearchText(capability, { includeRisk: false }))
        .join(" "),
      capabilityFacets: capabilities
        .flatMap((capability) =>
          capabilityFacetEntries(capability.Facets).flatMap((entry) => entry.values))
        .join(" "),
      capabilityRiskText: capabilities
        .map((capability) => capabilityRiskText(capability.Risk))
        .join(" "),
    };
  }

  private buildQuery(input: AgentPiResourceSelectionInput): string {
    return [
      input.input,
      input.turnUnderstanding?.standaloneRequest,
      input.turnUnderstanding?.contextBasis,
      input.rootCommand?.action,
      input.rootCommand?.objective,
      input.rootCommand?.instruction,
      ...(input.rootCommand?.preferredTools ?? []),
      ...(input.rootCommand?.toolSearchQueries ?? []),
      ...(input.rootCommand?.needs.flatMap((need) => [
        ...need.actions,
        ...need.targets,
        ...need.inputs,
        ...need.outputs,
        ...need.evidence,
        ...need.effects,
      ]) ?? []),
      ...(input.activeSkills?.flatMap((skill) => [
        skill.name,
        skill.title,
        skill.summary,
        ...skill.useCases,
        ...skill.recommendedTools,
        ...skill.matchedTerms,
      ]) ?? []),
    ].filter(hasText).join("\n");
  }
}

function templateResourceMetadata(
  template: RegisteredTemplate,
  key: string,
): string[] {
  return [
    ...new Set(
      (template.search?.Capabilities ?? []).flatMap((capability) => {
        const value = capability.Metadata?.[key];
        return typeof value === "string" && value.trim().length > 0 ? [value] : [];
      }),
    ),
  ];
}

function stableTemplateDocumentId(template: RegisteredTemplate): string {
  return crypto
    .createHash("sha1")
    .update(`${template.plugin.manifest.Plugin.Name}:${template.name}`)
    .digest("hex");
}

function hasText(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
