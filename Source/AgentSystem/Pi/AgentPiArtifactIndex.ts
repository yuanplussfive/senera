import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
  readAgentPiToolObservation,
  readAgentPiToolObservationArtifactUri,
  readAgentPiMessageTextContent,
  isAgentPiToolResultMessage,
} from "./AgentPiToolObservation.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { AgentWorkspaceContinuityCheckpointSchema } from "../Continuity/AgentContinuityLedger.js";

export const AgentPiArtifactIndexCustomType = "senera.artifact_index";

const NonBlankStringSchema = z.string().trim().min(1);

export const AgentPiArtifactReferenceSchema = z
  .object({
    artifactUri: NonBlankStringSchema,
    toolNames: z.array(NonBlankStringSchema),
    callIds: z.array(NonBlankStringSchema),
    evidenceUris: z.array(NonBlankStringSchema),
    refs: z.array(NonBlankStringSchema),
    workspaceCheckpointId: NonBlankStringSchema.optional(),
    workspaceRevision: NonBlankStringSchema.optional(),
  })
  .strict();

export const AgentPiArtifactIndexSchema = z
  .object({
    artifacts: z.array(AgentPiArtifactReferenceSchema),
  })
  .strict();

export type AgentPiArtifactReference = z.infer<typeof AgentPiArtifactReferenceSchema>;
export type AgentPiArtifactIndex = z.infer<typeof AgentPiArtifactIndexSchema>;

export interface AgentPiArtifactIndexReadResult {
  artifacts: AgentPiArtifactReference[];
  invalidEntryId?: string;
}

export function createAgentPiArtifactIndex(
  previous: readonly AgentPiArtifactReference[],
  messages: readonly AgentMessage[],
): AgentPiArtifactIndex {
  return {
    artifacts: mergeAgentPiArtifactReferences([...previous, ...projectAgentPiArtifactReferences(messages)]),
  };
}

export function readAgentPiArtifactIndex(entries: readonly SessionEntry[]): AgentPiArtifactIndexReadResult {
  let entry: SessionEntry | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index];
    if (candidate?.type === "custom" && candidate.customType === AgentPiArtifactIndexCustomType) {
      entry = candidate;
      break;
    }
  }
  if (!entry || entry.type !== "custom") return { artifacts: [] };

  const parsed = AgentPiArtifactIndexSchema.safeParse(entry.data);
  return parsed.success ? { artifacts: parsed.data.artifacts } : { artifacts: [], invalidEntryId: entry.id };
}

export function projectAgentPiArtifactReferences(messages: readonly AgentMessage[]): AgentPiArtifactReference[] {
  return mergeAgentPiArtifactReferences(messages.flatMap(projectToolResultArtifactReferences));
}

export function mergeAgentPiArtifactReferences(
  references: readonly AgentPiArtifactReference[],
): AgentPiArtifactReference[] {
  const byUri = new Map<string, AgentPiArtifactReference>();
  for (const reference of references) {
    const current = byUri.get(reference.artifactUri);
    byUri.set(reference.artifactUri, {
      artifactUri: reference.artifactUri,
      toolNames: uniqueStrings([...(current?.toolNames ?? []), ...reference.toolNames]),
      callIds: uniqueStrings([...(current?.callIds ?? []), ...reference.callIds]),
      evidenceUris: uniqueStrings([...(current?.evidenceUris ?? []), ...reference.evidenceUris]),
      refs: uniqueStrings([...(current?.refs ?? []), ...reference.refs]),
      ...(reference.workspaceCheckpointId || current?.workspaceCheckpointId
        ? { workspaceCheckpointId: reference.workspaceCheckpointId ?? current?.workspaceCheckpointId }
        : {}),
      ...(reference.workspaceRevision || current?.workspaceRevision
        ? { workspaceRevision: reference.workspaceRevision ?? current?.workspaceRevision }
        : {}),
    });
  }
  return [...byUri.values()];
}

function projectToolResultArtifactReferences(message: AgentMessage): AgentPiArtifactReference[] {
  if (!isAgentPiToolResultMessage(message)) return [];

  const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
  if (!observation) return [];
  const artifactUri = readAgentPiToolObservationArtifactUri(observation);
  const workspaceCheckpoint = readWorkspaceCheckpoint(observation.detail.workspace);
  const references = artifactUri
    ? [
        createArtifactReference({
          artifactUri,
          toolName: message.toolName,
          callId: message.toolCallId,
          ...(workspaceCheckpoint
            ? { workspaceCheckpointId: workspaceCheckpoint.id, workspaceRevision: workspaceCheckpoint.revision }
            : {}),
        }),
      ]
    : [];

  return [
    ...references,
    ...observation.detail.evidence.flatMap((evidence) => {
      const evidenceArtifactUri = evidence.artifact_uri ?? artifactUri;
      return evidenceArtifactUri
        ? [
            createArtifactReference({
              artifactUri: evidenceArtifactUri,
              toolName: message.toolName,
              callId: message.toolCallId,
              evidenceUri: evidence.evidence_uri,
              refs: uniqueStrings(evidence.artifact_refs ?? []),
              ...(workspaceCheckpoint
                ? { workspaceCheckpointId: workspaceCheckpoint.id, workspaceRevision: workspaceCheckpoint.revision }
                : {}),
            }),
          ]
        : [];
    }),
  ];
}

function createArtifactReference(input: {
  artifactUri: string;
  toolName?: string;
  callId?: string;
  evidenceUri?: string;
  refs?: string[];
  workspaceCheckpointId?: string;
  workspaceRevision?: string;
}): AgentPiArtifactReference {
  return {
    artifactUri: input.artifactUri,
    toolNames: input.toolName ? [input.toolName] : [],
    callIds: input.callId ? [input.callId] : [],
    evidenceUris: input.evidenceUri ? [input.evidenceUri] : [],
    refs: uniqueStrings(input.refs ?? []),
    ...(input.workspaceCheckpointId ? { workspaceCheckpointId: input.workspaceCheckpointId } : {}),
    ...(input.workspaceRevision ? { workspaceRevision: input.workspaceRevision } : {}),
  };
}

function readWorkspaceCheckpoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return AgentWorkspaceContinuityCheckpointSchema.safeParse((value as Record<string, unknown>).checkpoint).data;
}
