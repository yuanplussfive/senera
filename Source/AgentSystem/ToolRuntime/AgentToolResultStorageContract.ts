import {
  ToolResultStorageModes,
  type ToolArtifactPolicyManifest,
  type ToolResultStorageMode,
} from "../Types/AgentToolContractTypes.js";

export interface AgentToolResultStorageContractIssue {
  readonly field: "artifacts" | "workspace";
  readonly message: string;
}

/**
 * A source view is permitted only when its package can prove where the
 * already-published source Artifact is declared in the result contract.
 */
export function inspectAgentToolResultStorageContract(input: {
  readonly resultStorage?: ToolResultStorageMode;
  readonly artifacts?: ToolArtifactPolicyManifest;
}): readonly AgentToolResultStorageContractIssue[] {
  if (input.resultStorage !== ToolResultStorageModes.SourceView) return [];

  const sourceEvidence = input.artifacts?.Evidence?.some((evidence) => {
    const artifactUriSlot = evidence.PlannerMemory.ArtifactUri;
    return artifactUriSlot !== undefined && Object.hasOwn(evidence.Slots, artifactUriSlot);
  });
  const issues: AgentToolResultStorageContractIssue[] = [];
  if (!sourceEvidence) {
    issues.push({
      field: "artifacts",
      message:
        "Runtime.ResultStorage=SourceView requires Artifacts.Evidence with PlannerMemory.ArtifactUri backed by a declared evidence slot.",
    });
  }
  if (input.artifacts?.Workspace) {
    issues.push({
      field: "workspace",
      message:
        "Runtime.ResultStorage=SourceView cannot declare Artifacts.Workspace because a source view owns no mutation receipt.",
    });
  }
  return issues;
}
