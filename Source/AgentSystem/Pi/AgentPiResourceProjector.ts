import fs from "node:fs";
import crypto from "node:crypto";
import type { AgentHarnessResources, PromptTemplate, Skill } from "@earendil-works/pi-agent-core";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { RegisteredSkill, RegisteredTemplate } from "../Types/PluginRuntimeTypes.js";
import { AgentPiResourceSelector, type AgentPiResourceSelection } from "./AgentPiResourceSelector.js";

export interface AgentPiResourceProjectionInput {
  input?: string;
  turnUnderstanding?: TurnUnderstanding;
  rootCommand?: AgentRootCommand;
  activeSkills?: readonly AgentActivatedSkill[];
}

export type AgentPiHarnessResources = AgentHarnessResources<Skill, PromptTemplate>;

export interface AgentPiProjectedResources {
  harnessResources: AgentPiHarnessResources;
  selection: AgentPiResourceSelection;
  fingerprint: string;
}

export class AgentPiResourceProjector {
  private readonly selector = new AgentPiResourceSelector();
  private readonly textByPath = new Map<string, CachedText>();
  private readonly promptTemplateByName = new Map<string, CachedPromptTemplate>();

  constructor(private readonly registry: AgentPluginRegistry) {}

  project(input: AgentPiResourceProjectionInput = {}): AgentPiProjectedResources {
    const selection = this.selector.select({
      input,
      templates: this.registry.listTemplates(),
    });

    const harnessResources = {
      skills: this.projectSkills(input.activeSkills),
      promptTemplates: this.projectPromptTemplates(),
    };
    return {
      harnessResources,
      selection,
      fingerprint: crypto.createHash("sha256").update(JSON.stringify(harnessResources)).digest("hex"),
    };
  }

  private projectSkills(activeSkills: readonly AgentActivatedSkill[] = []): Skill[] {
    const registeredByName = new Map(this.registry.listSkills().map((skill) => [skill.name, skill]));
    return activeSkills.map((skill) => this.projectSkill(skill, registeredByName.get(skill.name)));
  }

  private projectSkill(skill: AgentActivatedSkill, registered: RegisteredSkill | undefined): Skill {
    const descriptionFile = registered?.descriptionFile ?? skill.descriptionFile;
    return {
      name: skill.name,
      description: this.skillDescription(skill),
      content: this.readTextFile(descriptionFile),
      filePath: descriptionFile,
    };
  }

  private skillDescription(skill: AgentActivatedSkill): string {
    return [skill.title, skill.summary, ...skill.useCases].filter(hasText).join("\n");
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

  private projectPromptTemplates(): PromptTemplate[] {
    return this.registry
      .listTemplates()
      .filter((template) => template.exposeToPi)
      .map((template) => this.projectPromptTemplate(template));
  }

  readTextFile(filePath: string): string {
    const revision = fs.statSync(filePath);
    const cached = this.textByPath.get(filePath);
    if (
      cached &&
      cached.mtimeMs === revision.mtimeMs &&
      cached.size === revision.size &&
      cached.ctimeMs === revision.ctimeMs
    ) {
      return cached.content;
    }
    const content = fs.readFileSync(filePath, "utf8");
    this.textByPath.set(filePath, {
      mtimeMs: revision.mtimeMs,
      ctimeMs: revision.ctimeMs,
      size: revision.size,
      content,
    });
    return content;
  }
}

interface CachedText {
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly size: number;
  readonly content: string;
}

interface CachedPromptTemplate {
  readonly path: string;
  readonly description?: string;
  readonly content: string;
  readonly value: PromptTemplate;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
