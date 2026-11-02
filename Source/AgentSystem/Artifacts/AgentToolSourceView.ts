import { normalizeAgentArtifactUri } from "./AgentArtifactLocator.js";
import { projectArtifactEvidence } from "./AgentArtifactEvidenceProjection.js";
import type { ToolArtifactPolicyManifest } from "../Types/AgentToolContractTypes.js";
import type { AgentToolSourceArtifactReference, ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";

/**
 * A SourceView has no publication fallback: a successful read must name the
 * immutable Artifact it read. Otherwise the result cannot be recovered after
 * the active turn has been compacted.
 */
export class AgentToolSourceViewInvariantError extends Error {
  constructor(toolName: string, violation: string) {
    super(`SourceView tool ${toolName} violates its result-storage contract: ${violation}.`);
    this.name = "AgentToolSourceViewInvariantError";
  }
}

/** Source views may expose a transient read page but must never own new durable output. */
export function assertAgentToolSourceViewExecution(
  result: Pick<ExecutedToolCallResult, "name" | "artifactPayload" | "outputCapture" | "workspaceCapture" | "artifact">,
): void {
  const newDurableOutput = [
    result.artifactPayload ? "artifactPayload" : undefined,
    result.outputCapture ? "outputCapture" : undefined,
    result.workspaceCapture ? "workspaceCapture" : undefined,
    result.artifact ? "artifact" : undefined,
  ].filter((value): value is string => value !== undefined);
  if (newDurableOutput.length > 0) {
    throw new AgentToolSourceViewInvariantError(
      result.name,
      `declared a new durable output (${newDurableOutput.join(", ")})`,
    );
  }
}

/**
 * Resolves durable source coordinates entirely from the tool package's
 * evidence declaration. A source view never manufactures a new artifact or
 * evidence URI for content that was only read from an existing artifact.
 */
export function projectAgentToolSourceArtifacts(
  value: unknown,
  policy: ToolArtifactPolicyManifest | undefined,
): readonly AgentToolSourceArtifactReference[] {
  const references = new Map<string, Set<string>>();
  for (const evidence of projectArtifactEvidence(value, policy)) {
    const artifactUri = evidence.plannerMemory.artifactUri;
    const normalizedArtifactUri = artifactUri ? normalizeAgentArtifactUri(artifactUri) : undefined;
    if (!normalizedArtifactUri) continue;
    const refs = references.get(normalizedArtifactUri) ?? new Set<string>();
    for (const ref of evidence.plannerMemory.artifactRefs) {
      const normalizedRef = ref.trim();
      if (normalizedRef) refs.add(normalizedRef);
    }
    references.set(normalizedArtifactUri, refs);
  }
  return [...references].map(([artifactUri, refs]) => ({ artifactUri, refs: [...refs] }));
}

export function assertAgentToolSourceViewReferences(
  toolName: string,
  references: readonly AgentToolSourceArtifactReference[],
): asserts references is readonly [AgentToolSourceArtifactReference, ...AgentToolSourceArtifactReference[]] {
  const hasOnlyCanonicalArtifacts = references.every(
    (reference) => normalizeAgentArtifactUri(reference.artifactUri) === reference.artifactUri,
  );
  if (references.length === 0 || !hasOnlyCanonicalArtifacts) {
    throw new AgentToolSourceViewInvariantError(toolName, "completed without a canonical source Artifact reference");
  }
}
