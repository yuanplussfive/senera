import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import {
  readAgentPiMessageTextContent,
  readAgentPiToolObservation,
  isAgentPiToolResultMessage,
} from "./AgentPiToolObservation.js";
import { parseAgentPiToolDetails } from "./AgentPiToolResultDetails.js";
import { readStringArray, uniqueStrings } from "../Core/AgentCollections.js";
import { readAgentNonBlankString, readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

export const AgentPiArtifactIndexCustomType = "senera.artifact_index";

const NonBlankStringSchema = z.string().trim().min(1);

export const AgentPiArtifactReferenceSchema = z
  .object({
    artifactUri: NonBlankStringSchema,
    toolNames: z.array(NonBlankStringSchema),
    callIds: z.array(NonBlankStringSchema),
    evidenceUris: z.array(NonBlankStringSchema),
    refs: z.array(NonBlankStringSchema),
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
    });
  }
  return [...byUri.values()];
}

function projectToolResultArtifactReferences(message: AgentMessage): AgentPiArtifactReference[] {
  if (!isAgentPiToolResultMessage(message)) return [];

  const record = readAgentUnknownRecord(message);
  const details = parseAgentPiToolDetails(record?.details)?.senera;
  const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
  const toolName = details?.toolName ?? readAgentNonBlankString(record?.toolName);
  const callId = details?.callId ?? readAgentNonBlankString(record?.toolCallId);
  const artifactUri = details?.artifactUri ?? readAgentNonBlankString(observation?.artifact_uri);
  const references = artifactUri ? [createArtifactReference({ artifactUri, toolName, callId })] : [];

  return [
    ...references,
    ...readEvidenceEntries(observation?.evidence).flatMap((evidence) => {
      const evidenceUri = readAgentNonBlankString(evidence.evidence_uri);
      const evidenceArtifactUri = readAgentNonBlankString(evidence.artifact_uri) ?? artifactUri;
      return evidenceArtifactUri
        ? [
            createArtifactReference({
              artifactUri: evidenceArtifactUri,
              toolName,
              callId,
              evidenceUri,
              refs: readStringArray(evidence.artifact_refs, { deduplicate: true, rejectBlank: true }),
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
}): AgentPiArtifactReference {
  return {
    artifactUri: input.artifactUri,
    toolNames: input.toolName ? [input.toolName] : [],
    callIds: input.callId ? [input.callId] : [],
    evidenceUris: input.evidenceUri ? [input.evidenceUri] : [],
    refs: uniqueStrings(input.refs ?? []),
  };
}

function readEvidenceEntries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = readAgentUnknownRecord(entry);
        return record ? [record] : [];
      })
    : [];
}
