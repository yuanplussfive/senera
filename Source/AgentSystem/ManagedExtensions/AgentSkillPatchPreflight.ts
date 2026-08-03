import path from "node:path";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import { assertAgentSkillToolReferences } from "../Skills/AgentSkillToolBinding.js";
import { extensionDiagnosticsFromError, projectCandidateDiagnostics } from "./AgentExtensionDiagnostic.js";
import { resolveAgentManagedExtensionPaths } from "./AgentManagedExtensionPaths.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import {
  AgentExtensionPatchPreflightError,
  changedAgentExtensionNames,
  stageAgentExtensionCandidate,
  type AgentExtensionPatchPlan,
  type AgentExtensionPatchValidation,
} from "./AgentExtensionPatchCandidate.js";

export class AgentSkillPatchPreflight {
  private readonly skillRoot: string;
  private readonly scanner = new AgentSkillScanner();

  constructor(
    private readonly workspaceRoot: string,
    private readonly registry: AgentExtensionRegistryLike,
  ) {
    this.skillRoot = resolveAgentManagedExtensionPaths(workspaceRoot).skillRoot;
  }

  validate(plan: AgentExtensionPatchPlan, changedPaths: readonly string[]): AgentExtensionPatchValidation[] {
    return [...changedAgentExtensionNames(this.workspaceRoot, this.skillRoot, changedPaths)]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((name) => this.validateSkill(plan, name));
  }

  private validateSkill(plan: AgentExtensionPatchPlan, name: string): AgentExtensionPatchValidation[] {
    const candidate = stageAgentExtensionCandidate({
      workspaceRoot: this.workspaceRoot,
      collectionRoot: this.skillRoot,
      name,
      plan,
    });
    try {
      if (!candidate.exists) return [];
      const skill = this.scanner.readSkillDirectory(candidate.candidatePath, name);
      assertAgentSkillToolReferences(skill, this.registry);
      return [{ kind: "Skill", name, path: candidate.sourcePath, status: "validated" }];
    } catch (error) {
      const diagnostics = projectCandidateDiagnostics(
        extensionDiagnosticsFromError(error, {
          code: "skill.patch.preflight",
          fallbackFilePath: path.join(candidate.candidatePath, "SKILL.md"),
        }),
        {
          candidateRoot: candidate.candidatePath,
          reportedRoot: candidate.sourcePath,
          previousRoot: candidate.previousExists ? candidate.sourcePath : undefined,
        },
      );
      throw new AgentExtensionPatchPreflightError("Skill", name, diagnostics);
    } finally {
      candidate.dispose();
    }
  }
}
