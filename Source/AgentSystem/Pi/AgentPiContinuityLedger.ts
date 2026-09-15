import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import {
  AgentContinuityLedgerCustomType,
  createAgentContinuityReference,
  readAgentContinuityLedger,
  type AgentContinuityLedger,
} from "../Continuity/AgentContinuityLedger.js";
import { AgentContinuityLayer } from "../Continuity/AgentContinuityLayer.js";
import type { AgentPiArtifactIndex } from "./AgentPiArtifactIndex.js";
import type { AgentPiCompactionToolCallIndex } from "./AgentPiCompactionToolIndex.js";

const ContinuityProjectionLimits = Object.freeze({
  messageSummaryCharacters: 768,
  searchCharacters: 1_536,
  references: 256,
  checkpoints: 32,
});

export interface AgentPiContinuityLedgerInput {
  readonly scope: string;
  readonly entries: readonly SessionEntry[];
  readonly messages: readonly AgentMessage[];
  readonly artifactIndex: AgentPiArtifactIndex;
  readonly toolCallIndex: AgentPiCompactionToolCallIndex;
  readonly summary?: string;
}

export function createAgentPiContinuityLedger(input: AgentPiContinuityLedgerInput): AgentContinuityLedger {
  const previous = readAgentPiContinuityLedger(input.entries);
  const references = [
    ...projectConversationReferences(input.messages),
    ...projectArtifactReferences(input.artifactIndex),
    ...projectToolReferences(input.toolCallIndex),
    ...(input.summary?.trim() ? [projectCompactionReference(input.summary)] : []),
  ];
  // Carry one prior restore point only when its complete reference set fits the
  // bounded ledger. Older checkpoints are still available in the append-only
  // session history, but keeping them in every compact projection would pin all
  // historical references forever and defeat the continuity budget.
  const previousCheckpoint = previous?.checkpoints.at(-1);
  const previousReferenceIds = new Set(previous?.references.map((reference) => reference.id) ?? []);
  const canCarryPreviousCheckpoint = Boolean(
    previousCheckpoint &&
    previousCheckpoint.referenceIds.length <= ContinuityProjectionLimits.references &&
    previousCheckpoint.referenceIds.every((referenceId) => previousReferenceIds.has(referenceId)),
  );
  const layer = new AgentContinuityLayer(input.scope);
  layer.ingest({ references: [...(previous?.references ?? []), ...references] });
  // Select the newest source references before reintroducing the old restore
  // point. This keeps the current compaction evidence from being displaced by
  // a previous checkpoint that already consumed the entire budget.
  layer.compact({ maxReferences: ContinuityProjectionLimits.references, maxCheckpoints: 0 });
  const retainedReferences = layer.snapshot().references;
  const retainedReferenceIds = new Set(retainedReferences.map((reference) => reference.id));
  const carryPreviousCheckpoint =
    canCarryPreviousCheckpoint &&
    previousCheckpoint &&
    previousCheckpoint.referenceIds.every((referenceId) => retainedReferenceIds.has(referenceId));
  if (carryPreviousCheckpoint) layer.ingest({ checkpoints: [previousCheckpoint] });
  layer.checkpoint({
    referenceIds: retainedReferences.map((reference) => reference.id),
    parentCheckpointId: carryPreviousCheckpoint ? previousCheckpoint?.id : undefined,
    resume: input.summary?.trim() ? { summaryUri: references.at(-1)?.uri, status: "compacted" } : { status: "active" },
  });
  return layer.compact({
    maxReferences: ContinuityProjectionLimits.references,
    maxCheckpoints: ContinuityProjectionLimits.checkpoints,
  });
}

export function readAgentPiContinuityLedger(entries: readonly SessionEntry[]): AgentContinuityLedger | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== AgentContinuityLedgerCustomType) continue;
    const ledger = readAgentContinuityLedger(entry.data);
    if (ledger) return ledger;
  }
  return undefined;
}

function projectConversationReferences(messages: readonly AgentMessage[]) {
  return messages.flatMap((message, index) => {
    const text = projectMessageText(message);
    const toolNames =
      message.role === "assistant"
        ? message.content.flatMap((part) => (part.type === "toolCall" ? [part.name] : []))
        : [];
    const summary = trimText(text || toolNames.join(", "), ContinuityProjectionLimits.messageSummaryCharacters);
    if (!summary) return [];
    const timestamp = "timestamp" in message && typeof message.timestamp === "number" ? message.timestamp : undefined;
    const digest = sha256HexOfCanonicalJson({
      role: message.role,
      text,
      toolNames,
      ...(timestamp === undefined ? { sequence: index } : { timestamp }),
    });
    return [
      createAgentContinuityReference({
        kind: "conversation",
        uri: `senera://conversation/message/${digest.slice(0, 32)}`,
        revision: digest,
        summary,
        searchText: trimText([text, ...toolNames].join(" "), ContinuityProjectionLimits.searchCharacters),
      }),
    ];
  });
}

function projectArtifactReferences(index: AgentPiArtifactIndex) {
  return index.artifacts.map((artifact) =>
    createAgentContinuityReference({
      kind: "artifact",
      uri: artifact.artifactUri,
      revision: artifact.artifactUri,
      summary: `Artifact ${artifact.artifactUri}`,
      searchText: trimText(
        [
          ...artifact.toolNames,
          ...artifact.callIds,
          ...artifact.evidenceUris,
          ...artifact.refs,
          artifact.workspaceCheckpointId ?? "",
          artifact.workspaceRevision ?? "",
        ].join(" "),
        ContinuityProjectionLimits.searchCharacters,
      ),
      metadata: {
        toolNames: artifact.toolNames,
        callIds: artifact.callIds,
        evidenceUris: artifact.evidenceUris,
        refs: artifact.refs,
        ...(artifact.workspaceCheckpointId ? { workspaceCheckpointId: artifact.workspaceCheckpointId } : {}),
        ...(artifact.workspaceRevision ? { workspaceRevision: artifact.workspaceRevision } : {}),
      },
    }),
  );
}

function projectToolReferences(index: AgentPiCompactionToolCallIndex) {
  return index.calls.map((call) =>
    createAgentContinuityReference({
      kind: "conversation",
      uri: `senera://tool-call/${call.callId}`,
      revision: call.callId,
      summary: call.summary ?? `${call.toolName} ${call.status}`,
      searchText: trimText(
        [call.toolName, call.argumentsPreview, call.artifactUri ?? "", ...call.evidenceUris].join(" "),
        ContinuityProjectionLimits.searchCharacters,
      ),
      metadata: {
        toolName: call.toolName,
        status: call.status,
        ...(call.artifactUri ? { artifactUri: call.artifactUri } : {}),
      },
    }),
  );
}

function projectCompactionReference(summary: string) {
  const digest = sha256HexOfCanonicalJson(summary.trim());
  return createAgentContinuityReference({
    kind: "compaction",
    uri: `senera://compaction/${digest.slice(0, 32)}`,
    revision: digest,
    summary: trimText(summary, ContinuityProjectionLimits.messageSummaryCharacters),
    searchText: trimText(summary, ContinuityProjectionLimits.searchCharacters),
  });
}

function projectMessageText(message: AgentMessage): string {
  switch (message.role) {
    case "user":
    case "custom":
      return typeof message.content === "string"
        ? message.content
        : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    case "assistant":
      return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    case "toolResult":
      return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    case "compactionSummary":
    case "branchSummary":
      return message.summary;
    case "bashExecution":
      return [message.command, message.output].filter(Boolean).join("\n");
    default:
      return "";
  }
}

function trimText(value: string, limit: number): string {
  const normalized = value.trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
