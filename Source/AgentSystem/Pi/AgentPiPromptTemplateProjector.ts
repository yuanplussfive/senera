import type { PromptTemplate } from "@earendil-works/pi-agent-core";
import { readRegularTextFileSnapshotSync, type AgentRegularTextFileSnapshot } from "../Core/AgentFs.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { RegisteredTemplate } from "../Types/AgentToolRuntimeTypes.js";
import { AgentPiResourceSelector, type AgentPiResourceSelection } from "./AgentPiResourceSelector.js";

export interface AgentPiPromptTemplateProjectionInput {
  input?: string;
  rootCommand?: AgentRootCommand;
  activeSkills?: readonly AgentActivatedSkill[];
}

export interface AgentPiPromptTemplateProjection {
  promptTemplates: PromptTemplate[];
  selection: AgentPiResourceSelection;
}

export class AgentPiPromptTemplateProjector {
  private readonly selector = new AgentPiResourceSelector();
  private readonly textByPath = new Map<string, CachedText>();
  private readonly promptTemplateByName = new Map<string, CachedPromptTemplate>();

  constructor(private readonly registry: AgentExtensionRegistry) {}

  project(input: AgentPiPromptTemplateProjectionInput = {}): AgentPiPromptTemplateProjection {
    return {
      promptTemplates: this.registry
        .listTemplates()
        .filter((template) => template.exposeToPi)
        .map((template) => this.projectPromptTemplate(template)),
      selection: this.selector.select({
        input,
        templates: this.registry.listTemplates(),
      }),
    };
  }

  projectPromptTemplate(template: RegisteredTemplate): PromptTemplate {
    const content = this.readTextFile(template.path);
    const cached = this.promptTemplateByName.get(template.name);
    if (
      cached &&
      cached.path === template.path &&
      cached.description === template.description &&
      cached.content === content
    ) {
      return cached.value;
    }
    const value = { name: template.name, description: template.description, content };
    this.promptTemplateByName.set(template.name, {
      path: template.path,
      description: template.description,
      content,
      value,
    });
    return value;
  }

  private readTextFile(filePath: string): string {
    const cached = this.textByPath.get(filePath);
    const revision = readRegularTextFileSnapshotSync(filePath, "Pi prompt template", cached);
    if (cached === revision) return cached.content;
    this.textByPath.set(filePath, revision);
    return revision.content;
  }
}

type CachedText = AgentRegularTextFileSnapshot;

interface CachedPromptTemplate {
  readonly path: string;
  readonly description?: string;
  readonly content: string;
  readonly value: PromptTemplate;
}
