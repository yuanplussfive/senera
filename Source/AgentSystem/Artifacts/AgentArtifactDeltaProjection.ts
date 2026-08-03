import type {
  ToolArtifactDeltaRecord,
  ToolArtifactEvidenceRecord,
  ToolWorkspaceChange,
} from "../Types/ToolRuntimeTypes.js";

export function buildArtifactDelta(input: {
  readonly evidence: readonly ToolArtifactEvidenceRecord[];
  readonly previousEvidence: ReadonlySet<string>;
  readonly workspaceChanges?: readonly ToolWorkspaceChange[];
}): ToolArtifactDeltaRecord[] {
  return [
    ...input.evidence.map(
      (entry) =>
        ({
          kind: "evidence",
          key: entry.key,
          status: input.previousEvidence.has(entry.key) ? "unchanged" : "added",
          summary: entry.label,
          metadata: { evidenceKind: entry.kind },
        }) satisfies ToolArtifactDeltaRecord,
    ),
    ...(input.workspaceChanges ?? []).map(
      (change) =>
        ({
          kind: "workspace",
          key: change.path,
          status: change.status === "unchanged" ? "unchanged" : "changed",
          summary: `${change.status}: ${change.path}`,
          metadata: {
            beforeHash: change.beforeHash,
            afterHash: change.afterHash,
            beforeSize: change.beforeSize,
            afterSize: change.afterSize,
            patch: change.patch,
          },
        }) satisfies ToolArtifactDeltaRecord,
    ),
  ];
}
