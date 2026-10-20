import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { uniqueStrings } from "../Core/AgentCollections.js";
import {
  assertAgentPiToolObservationBounded,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
export {
  AgentPiToolObservationProtocol,
  AgentPiToolObservationProtocolError,
  AgentPiToolObservationSourceViewProtocol,
  assertAgentPiToolObservationBounded,
  createAgentPiToolObservation,
  isAgentPiObservationSourceBounded,
  parseAgentPiToolObservation,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
export {
  AgentPiToolObservationStatuses,
  type AgentPiToolObservationStatus,
  readAgentPiToolObservationStatus,
} from "../PiShared/AgentPiToolObservationStatus.js";

export function readAgentPiMessageTextContent(message: Extract<AgentMessage, { role: "toolResult" }>): string {
  return unwrapAttributedToolObservation(
    message.content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join(""),
  );
}

/**
 * Reads the Tool's declared output from Pi's observation envelope. The
 * envelope's surrounding detail contains transport feedback (process,
 * evidence, continuation), while `detail.result` is the value against which
 * every `.tool.json` output pointer is validated.
 */
export function projectAgentPiToolResultContentForDisplay(
  content: Extract<AgentMessage, { role: "toolResult" }>["content"],
): unknown {
  const text = unwrapAttributedToolObservation(
    content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join(""),
  );
  const observation = readAgentPiToolObservation(text);
  if (observation) return projectAgentPiToolObservationDetail(observation).result;
  return text || undefined;
}

/**
 * Returns Pi's canonical execution failure without exposing the observation
 * envelope itself to product surfaces. Callers may preserve non-Pi text as
 * their own error path when this strict protocol decoder returns undefined.
 */
export function readAgentPiToolObservationFailureMessage(content: string): string | undefined {
  return readAgentPiToolObservation(unwrapAttributedToolObservation(content))?.error?.message;
}

/**
 * BAML attribution is a wire-level XML envelope. Pi's internal history keeps
 * the same text, so every observation reader must remove the envelope before
 * validating the JSON protocol.
 */
function unwrapAttributedToolObservation(content: string): string {
  const prefix = '<observation attribution="tool">';
  const suffix = "</observation>";
  if (!content.startsWith(prefix) || !content.endsWith(suffix)) return content;
  return decodeXmlText(content.slice(prefix.length, -suffix.length));
}

function decodeXmlText(content: string): string {
  return content.replace(/&quot;|&apos;|&gt;|&lt;|&amp;/g, (entity) => {
    switch (entity) {
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      case "&gt;":
        return ">";
      case "&lt;":
        return "<";
      case "&amp;":
        return "&";
      default:
        return entity;
    }
  });
}

export function isAgentPiToolResultMessage(
  message: AgentMessage,
): message is Extract<AgentMessage, { role: "toolResult" }> {
  return message.role === "toolResult";
}

/** Every canonical Artifact coordinate carried by an observation, merged by URI. */
export interface AgentPiToolObservationArtifactReference {
  readonly artifactUri: string;
  readonly refs: readonly string[];
  readonly evidenceUris: readonly string[];
  /** The Artifact that owns this observation's bounded projection, if any. */
  readonly observationArtifact: boolean;
}

/**
 * Artifact coordinates can arrive via the bounded observation, a SourceView,
 * or declared evidence. Keep that wire knowledge in one place so compaction,
 * planning, and archival indexes cannot diverge.
 */
export function readAgentPiToolObservationArtifactReferences(
  observation: AgentPiToolObservation,
): readonly AgentPiToolObservationArtifactReference[] {
  const references = new Map<string, { refs: string[]; evidenceUris: string[]; observationArtifact: boolean }>();
  const add = (
    artifactUri: string | undefined,
    input: {
      readonly refs?: readonly string[];
      readonly evidenceUri?: string;
      readonly evidenceUris?: readonly string[];
      readonly observationArtifact?: boolean;
    },
  ) => {
    const normalized = artifactUri?.trim();
    if (!normalized) return;
    const existing = references.get(normalized) ?? { refs: [], evidenceUris: [], observationArtifact: false };
    references.set(normalized, {
      refs: uniqueStrings([...existing.refs, ...(input.refs ?? [])]),
      evidenceUris: uniqueStrings([
        ...existing.evidenceUris,
        ...(input.evidenceUris ?? []),
        ...(input.evidenceUri ? [input.evidenceUri] : []),
      ]),
      observationArtifact: existing.observationArtifact || input.observationArtifact === true,
    });
  };

  const observationArtifactUri = observation.observation_view?.artifact_uri;
  add(observationArtifactUri, { observationArtifact: true });
  add(observation.artifact_uri, {
    refs: observation.artifact_refs,
    evidenceUris: observation.evidence_uris,
    observationArtifact: true,
  });
  for (const source of observation.source_artifacts ?? []) add(source.artifact_uri, { refs: source.refs });
  for (const evidence of observation.detail.evidence) {
    add(evidence.artifact_uri ?? observationArtifactUri, {
      refs: evidence.artifact_refs,
      evidenceUri: evidence.evidence_uri,
    });
  }
  return [...references].map(([artifactUri, reference]) => ({ artifactUri, ...reference }));
}

export function projectAgentPiToolObservationDetail(
  observation: AgentPiToolObservation,
): AgentPiToolObservation["detail"] {
  assertAgentPiToolObservationBounded(observation);
  return observation.detail;
}
