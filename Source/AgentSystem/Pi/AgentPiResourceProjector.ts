import fs from "node:fs";
import type {
  AgentHarnessResources,
  PromptTemplate,
  Skill,
} from "@earendil-works/pi-agent-core";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type {
  RegisteredSkill,
  RegisteredTemplate,
} from "../Types/PluginRuntimeTypes.js";
import {
  AgentPiResourceSelector,
  type AgentPiResourceSelection,
} from "./AgentPiResourceSelector.js";

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
}

export class AgentPiResourceProjector {
  private readonly selector = new AgentPiResourceSelector();

  constructor(private readonly registry: AgentPluginRegistry) {}

  project(input: AgentPiResourceProjectionInput = {}): AgentPiProjectedResources {
    const selection = this.selector.select({
      input,
      templates: this.registry.listTemplates(),
    });

    return {
      harnessResources: {
        skills: this.projectSkills(input.activeSkills),
        promptTemplates: this.projectPromptTemplates(),
      },
      selection,
    };
  }

  private projectSkills(activeSkills: readonly AgentActivatedSkill[] = []): Skill[] {
    const registeredByName = new Map(
      this.registry.listSkills().map((skill) => [skill.name, skill]),
    );
    return activeSkills.map((skill) =>
      this.projectSkill(skill, registeredByName.get(skill.name)));
  }

  private projectSkill(
    skill: AgentActivatedSkill,
    registered: RegisteredSkill | undefined,
  ): Skill {
    const descriptionFile = registered?.descriptionFile ?? skill.descriptionFile;
    return {
      name: skill.name,
      description: this.skillDescription(skill),
      content: this.readTextFile(descriptionFile),
      filePath: descriptionFile,
    };
  }

  private skillDescription(skill: AgentActivatedSkill): string {
    return [
      skill.title,
      skill.summary,
      ...skill.useCases,
    ].filter(hasText).join("\n");
  }

  private projectPromptTemplates(): PromptTemplate[] {
    return this.registry.listTemplates()
      .filter((template) => template.exposeToPi)
      .map((template) => this.projectPromptTemplate(template));
  }

  projectPromptTemplate(template: RegisteredTemplate): PromptTemplate {
    return {
      name: template.name,
      description: template.description,
      content: this.readTextFile(template.path),
    };
  }

  readTextFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf8");
  }
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
