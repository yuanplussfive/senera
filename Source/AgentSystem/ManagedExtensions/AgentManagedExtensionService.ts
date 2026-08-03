import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../Core/AgentFs.js";
import { parseAgentSkillDocument, stringifyAgentSkillDocument } from "../Skills/AgentSkillDocument.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import { assertAgentSkillToolReferences, withAgentSkillRecommendedTools } from "../Skills/AgentSkillToolBinding.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import type { AgentExtensionDiagnostic } from "./AgentExtensionDiagnostic.js";
import { assertAgentExtensionName } from "../Extensions/AgentExtensionIdentity.js";
import { resolveAgentManagedExtensionPaths, resolveManagedExtensionDirectory } from "./AgentManagedExtensionPaths.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";

export type AgentManagedSkillAction = "create" | "update" | "validate" | "remove";

export interface AgentManagedSkillInput {
  readonly action: AgentManagedSkillAction;
  readonly name: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly recommendedTools?: readonly string[];
}

export interface AgentManagedExtensionResult {
  readonly status: "created" | "updated" | "valid" | "removed";
  readonly action: AgentManagedSkillAction;
  readonly name: string;
  readonly path?: string;
  readonly diagnostics: { readonly item: readonly AgentExtensionDiagnostic[] };
  readonly recommendedTools: readonly string[];
  readonly guidance: string;
}

export class AgentManagedExtensionService {
  private readonly skillRoot: string;
  private readonly scanner = new AgentSkillScanner();

  constructor(
    private readonly workspaceRoot: string,
    private readonly registry: AgentExtensionRegistryLike,
  ) {
    this.skillRoot = resolveAgentManagedExtensionPaths(workspaceRoot).skillRoot;
  }

  manageSkill(input: AgentManagedSkillInput): AgentManagedExtensionResult {
    assertAgentExtensionName(input.name);
    switch (input.action) {
      case "create":
        return this.createSkill(input);
      case "update":
        return this.updateSkill(input);
      case "validate":
        return this.validateSkill(input.name);
      case "remove":
        return this.removeSkill(input.name);
    }
  }

  private createSkill(input: AgentManagedSkillInput): AgentManagedExtensionResult {
    const description = requiredText(input.description, "description", input.action);
    const instructions = requiredText(input.instructions, "instructions", input.action);
    const skillPath = this.skillPath(input.name);
    if (fs.existsSync(skillPath)) throw new Error(`Skill already exists: ${input.name}`);
    const skill = this.replaceSkillDirectory(input.name, undefined, (stagedPath) => {
      writeFileAtomicSync(
        path.join(stagedPath, "SKILL.md"),
        skillDocument(description, instructions, input.name, input.recommendedTools ?? []),
      );
    });
    return result("created", input.action, input.name, skillPath, skill.recommendedTools);
  }

  private updateSkill(input: AgentManagedSkillInput): AgentManagedExtensionResult {
    const skillPath = this.requireSkill(input.name);
    const skill = this.replaceSkillDirectory(input.name, skillPath, (stagedPath) => {
      if (input.description === undefined && input.instructions === undefined && input.recommendedTools === undefined) {
        return;
      }
      const documentPath = path.join(stagedPath, "SKILL.md");
      const parsed = parseAgentSkillDocument(fs.readFileSync(documentPath, "utf8"));
      const frontmatter = {
        ...parsed.data,
        name: input.name,
        description: input.description?.trim() || parsed.data.description,
      };
      writeFileAtomicSync(
        documentPath,
        stringifyAgentSkillDocument(
          `${input.instructions?.trim() || parsed.content.trim()}\n`,
          input.recommendedTools === undefined
            ? frontmatter
            : withAgentSkillRecommendedTools(frontmatter, input.recommendedTools),
        ),
      );
    });
    return result("updated", input.action, input.name, skillPath, skill.recommendedTools);
  }

  private validateSkill(name: string): AgentManagedExtensionResult {
    const skillPath = this.requireSkill(name);
    const skill = this.validateSkillDirectory(skillPath, name);
    return result("valid", "validate", name, skillPath, skill.recommendedTools);
  }

  private removeSkill(name: string): AgentManagedExtensionResult {
    const skillPath = this.requireSkill(name);
    fs.rmSync(skillPath, { recursive: true });
    return {
      status: "removed",
      action: "remove",
      name,
      diagnostics: { item: [] },
      recommendedTools: [],
      guidance: "The Skill is removed from the next user message in this conversation.",
    };
  }

  private replaceSkillDirectory(
    name: string,
    currentPath: string | undefined,
    update: (stagedPath: string) => void,
  ): RegisteredSkill {
    fs.mkdirSync(this.skillRoot, { recursive: true });
    const stagedPath = path.join(this.skillRoot, `.staging-${name}-${crypto.randomUUID()}`);
    const backupPath = path.join(this.skillRoot, `.previous-${name}-${crypto.randomUUID()}`);
    try {
      if (currentPath) fs.cpSync(currentPath, stagedPath, { recursive: true, errorOnExist: true, force: false });
      else fs.mkdirSync(stagedPath);
      update(stagedPath);
      const skill = this.validateSkillDirectory(stagedPath, name);
      if (currentPath) fs.renameSync(currentPath, backupPath);
      try {
        fs.renameSync(stagedPath, this.skillPath(name));
      } catch (error) {
        if (currentPath && fs.existsSync(backupPath)) fs.renameSync(backupPath, currentPath);
        throw error;
      }
      return skill;
    } finally {
      fs.rmSync(stagedPath, { recursive: true, force: true });
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
  }

  private requireSkill(name: string): string {
    const skillPath = this.skillPath(name);
    if (!fs.existsSync(skillPath)) throw new Error(`Skill does not exist: ${name}`);
    return skillPath;
  }

  private skillPath(name: string): string {
    return resolveManagedExtensionDirectory(this.skillRoot, name);
  }

  private validateSkillDirectory(skillPath: string, name: string): RegisteredSkill {
    const skill = this.scanner.readSkillDirectory(skillPath, name);
    assertAgentSkillToolReferences(skill, this.registry);
    return skill;
  }
}

function skillDocument(
  description: string,
  instructions: string,
  name: string,
  recommendedTools: readonly string[],
): string {
  return stringifyAgentSkillDocument(
    `${instructions.trim()}\n`,
    withAgentSkillRecommendedTools({ name, description: description.trim() }, recommendedTools),
  );
}

function requiredText(value: string | undefined, field: string, action: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${field} is required for ${action}.`);
  return normalized;
}

function result(
  status: "created" | "updated" | "valid",
  action: AgentManagedSkillAction,
  name: string,
  skillPath: string,
  recommendedTools: readonly string[],
): AgentManagedExtensionResult {
  return {
    status,
    action,
    name,
    path: skillPath,
    diagnostics: { item: [] },
    recommendedTools: [...recommendedTools],
    guidance: "The Skill is available on the next user message in this conversation; no restart is required.",
  };
}
