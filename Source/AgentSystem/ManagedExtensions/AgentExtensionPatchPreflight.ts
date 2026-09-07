import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentExtensionPatchPlan, AgentExtensionPatchValidation } from "./AgentExtensionPatchCandidate.js";
import { AgentMcpPackagePatchPreflight } from "./AgentMcpPackagePatchPreflight.js";
import { AgentSkillPatchPreflight } from "./AgentSkillPatchPreflight.js";

export class AgentExtensionPatchPreflight {
  constructor(
    private readonly workspaceRoot: string,
    private readonly registry: AgentExtensionRegistryLike,
  ) {}

  validate(plan: AgentExtensionPatchPlan, changedPaths: readonly string[]): AgentExtensionPatchValidation[] {
    return [
      ...new AgentSkillPatchPreflight(this.workspaceRoot, this.registry).validate(plan, changedPaths),
      ...new AgentMcpPackagePatchPreflight(this.workspaceRoot).validate(plan, changedPaths),
    ];
  }
}
