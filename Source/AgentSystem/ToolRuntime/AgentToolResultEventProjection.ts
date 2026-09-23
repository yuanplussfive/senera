import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { isAgentToolResultInline, type ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";

export const AgentArtifactBackedToolResultProtocol = defineSeneraProtocol("artifact_backed_tool_result", 1);

/**
 * Stable event/history reference for a result whose complete payload is
 * already durable in an Artifact. Presentation carries the human-readable
 * summary separately; this value preserves the recovery coordinates without
 * serializing the same large output into every run event.
 */
export interface AgentArtifactBackedToolResultReference {
  readonly type: typeof AgentArtifactBackedToolResultProtocol.type;
  readonly version: typeof AgentArtifactBackedToolResultProtocol.version;
  readonly artifactUri: string;
  readonly refs?: readonly string[];
}

/**
 * Keep small inline results inspectable in their original form. Once an
 * Artifact owns a non-inline result, event and trace storage carry a durable
 * reference instead. If publication failed, the original result remains the
 * only recoverable source and is therefore never replaced.
 */
export function projectAgentToolResultEventValue(result: ExecutedToolCallResult): unknown {
  const artifact = result.artifact;
  if (!artifact || isAgentToolResultInline(result)) return result.result;

  const refs = artifact.structuredSummary?.retrieval.refs ?? [];
  return {
    type: AgentArtifactBackedToolResultProtocol.type,
    version: AgentArtifactBackedToolResultProtocol.version,
    artifactUri: artifact.artifactUri,
    ...(refs.length > 0 ? { refs: [...refs] } : {}),
  } satisfies AgentArtifactBackedToolResultReference;
}
