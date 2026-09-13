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
import { createAgentSelfSkillsPort } from "../SelfService/AgentSelfSkills.js";
import type {
  AgentSelfSkillInspection,
  AgentSelfSkillMutationResult,
  AgentSelfSkillSummary,
} from "../SelfService/AgentSelfServiceTypes.js";

export type AgentManagedSkillAction = "create" | "update" | "validate" | "remove";

export interface AgentManagedSkillInput {
  readonly action: AgentManagedSkillAction;
  readonly name: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly recommendedTools?: readonly string[];
  readonly expectedRevision?: string;
}

export interface AgentManagedExtensionResult {
  readonly status: "created" | "updated" | "valid" | "removed";
  readonly action: AgentManagedSkillAction;
  readonly name: string;
  readonly path?: string;
  readonly revision?: string;
  readonly diagnostics: { readonly item: readonly AgentExtensionDiagnostic[] };
  readonly recommendedTools: readonly string[];
  readonly guidance: string;
}

export class AgentManagedExtensionService {
  private readonly skillRoot: string;
  private readonly scanner = new AgentSkillScanner();
  private readonly selfSkills: ReturnType<typeof createAgentSelfSkillsPort>;

  constructor(
    workspaceRoot: string,
    private readonly registry: AgentExtensionRegistryLike,
  ) {
    this.skillRoot = resolveAgentManagedExtensionPaths(workspaceRoot).skillRoot;
    this.selfSkills = createAgentSelfSkillsPort([
      {
        id: "workspace",
        displayName: "Workspace Skills",
        kind: "workspace",
        root: this.skillRoot,
      },
    ]);
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
        return this.removeSkill(input);
    }
  }

  private createSkill(input: AgentManagedSkillInput): AgentManagedExtensionResult {
    const description = requiredText(input.description, "description", input.action);
    const instructions = requiredText(input.instructions, "instructions", input.action);
    const skillPath = this.skillPath(input.name);
    const content = skillDocument(description, instructions, input.name, input.recommendedTools ?? []);
    this.validateSkillDocument(input.name, content);
    const mutation = this.selfSkills.create(input.name, content);
    const skill = requireCommittedSkill(mutation, input.name, "create");
    return result("created", input.action, input.name, skillPath, skill.skill.recommendedTools, skill.revision);
  }

  private updateSkill(input: AgentManagedSkillInput): AgentManagedExtensionResult {
    const current = this.requireCurrentSkill(input.name);
    const parsed = parseAgentSkillDocument(current.content);
    const frontmatter = {
      ...parsed.data,
      name: input.name,
      description: input.description?.trim() || parsed.data.description,
    };
    const content = stringifyAgentSkillDocument(
      `${input.instructions?.trim() || parsed.content.trim()}\n`,
      input.recommendedTools === undefined
        ? frontmatter
        : withAgentSkillRecommendedTools(frontmatter, input.recommendedTools),
    );
    this.validateSkillDocument(input.name, content);
    const mutation = this.selfSkills.update(
      input.name,
      content,
      input.expectedRevision?.trim() || current.skill.revision,
    );
    const skill = requireCommittedSkill(mutation, input.name, "update");
    return result(
      "updated",
      input.action,
      input.name,
      this.skillPath(input.name),
      skill.skill.recommendedTools,
      skill.revision,
    );
  }

  private validateSkill(name: string): AgentManagedExtensionResult {
    const current = this.requireCurrentSkill(name);
    const skill = this.validateSkillDocument(name, current.content);
    return result("valid", "validate", name, this.skillPath(name), skill.recommendedTools, current.skill.revision);
  }

  private removeSkill(input: AgentManagedSkillInput): AgentManagedExtensionResult {
    const name = input.name;
    const current = this.requireCurrentSkill(name);
    const mutation = this.selfSkills.archive(name, input.expectedRevision?.trim() || current.skill.revision);
    if (mutation.status !== "archived") {
      throw new Error(`Skill ${name} could not be archived: ${mutation.status}.`);
    }
    return {
      status: "removed",
      action: "remove",
      name,
      revision: current.skill.revision,
      diagnostics: { item: [] },
      recommendedTools: [...current.skill.recommendedTools],
      guidance: "The Skill is archived and removed from the next user message; its revision remains restorable.",
    };
  }

  private requireCurrentSkill(name: string): Extract<AgentSelfSkillInspection, { status: "found" }> {
    const current = this.selfSkills.inspect(name);
    if (current.status !== "found") throw new Error(current.error);
    return current;
  }

  private skillPath(name: string): string {
    return resolveManagedExtensionDirectory(this.skillRoot, name);
  }

  private validateSkillDirectory(skillPath: string, name: string): RegisteredSkill {
    const skill = this.scanner.readSkillDirectory(skillPath, name);
    assertAgentSkillToolReferences(skill, this.registry);
    return skill;
  }

  private validateSkillDocument(name: string, content: string): RegisteredSkill {
    fs.mkdirSync(this.skillRoot, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(this.skillRoot, `.validate-${name}-`));
    const stagingPath = path.join(stagingRoot, name);
    try {
      fs.mkdirSync(stagingPath);
      writeFileAtomicSync(path.join(stagingPath, "SKILL.md"), content);
      return this.validateSkillDirectory(stagingPath, name);
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
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
  revision?: string,
): AgentManagedExtensionResult {
  return {
    status,
    action,
    name,
    path: skillPath,
    ...(revision ? { revision } : {}),
    diagnostics: { item: [] },
    recommendedTools: [...recommendedTools],
    guidance: "The Skill is available on the next user message in this conversation; no restart is required.",
  };
}

function requireCommittedSkill(
  mutation: AgentSelfSkillMutationResult,
  name: string,
  operation: "create" | "update",
): {
  readonly status: "created" | "updated";
  readonly skill: AgentSelfSkillSummary;
  readonly revision: string;
  readonly previousRevision?: string;
} {
  if (mutation.status === "created" || mutation.status === "updated") {
    return {
      status: mutation.status,
      skill: mutation.skill,
      revision: mutation.revision,
      ...(mutation.previousRevision ? { previousRevision: mutation.previousRevision } : {}),
    };
  }
  throw new Error(`Skill ${name} ${operation} failed: ${mutation.status}.`);
}
