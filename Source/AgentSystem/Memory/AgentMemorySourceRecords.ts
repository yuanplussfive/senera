import {
  AgentConversationEntryKinds,
} from "../Conversation/AgentConversation.js";
import { compactObject } from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import type { AgentToolEvidenceMemoryEntryRecord } from "./AgentPlannerMemory.js";
import {
  memorySourceUri,
  stableMemoryId,
} from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import type {
  AgentMemoryCompletedTurnInput,
  AgentMemoryEpisodeRecord,
  AgentMemorySourceKind,
  AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";
import { terminalText } from "./AgentMemoryTerminalText.js";

export function buildSources(
  input: AgentMemoryCompletedTurnInput,
  episode: AgentMemoryEpisodeRecord,
): AgentMemorySourceRecord[] {
  const sources: AgentMemorySourceRecord[] = [
    buildSource({
      input,
      episode,
      sourceKind: "user_message",
      role: "user",
      key: input.userEntry.id,
      textContent: input.userEntry.content,
      summary: input.turnUnderstanding?.standaloneRequest ?? input.userEntry.content,
      conversationEntryId: input.userEntry.id,
      createdAt: input.userEntry.timestamp,
    }),
    buildSource({
      input,
      episode,
      sourceKind: "assistant_final",
      role: "assistant",
      key: input.assistantEntry.id,
      textContent: terminalText(input.terminal),
      summary: terminalText(input.terminal),
      conversationEntryId: input.assistantEntry.id,
      createdAt: input.assistantEntry.timestamp,
    }),
  ];

  const artifactSources = new Map<string, AgentMemorySourceRecord>();
  for (const entry of input.conversationEntries) {
    if (entry.kind !== AgentConversationEntryKinds.ToolEvidenceMemory) {
      continue;
    }

    if (entry.record.artifactUri) {
      artifactSources.set(entry.record.artifactUri, buildSource({
        input,
        episode,
        sourceKind: "artifact",
        role: "tool",
        key: entry.record.artifactUri,
        conversationEntryId: entry.id,
        artifactUri: entry.record.artifactUri,
        toolName: entry.record.toolName,
        createdAt: entry.timestamp,
      }));
    }

    for (const evidence of entry.record.evidence) {
      sources.push(buildSource({
        input,
        episode,
        sourceKind: "tool_evidence",
        role: "tool",
        key: evidence.evidenceUri,
        summary: evidence.display || evidence.label || evidence.kind,
        conversationEntryId: entry.id,
        evidenceUri: evidence.evidenceUri,
        artifactUri: evidence.artifactUri,
        toolName: evidence.toolName,
        createdAt: entry.timestamp,
        metadata: {
          evidence: projectMemoryEvidenceSource(evidence),
        },
      }));
    }
  }

  return [...sources, ...artifactSources.values()];
}

function buildSource(input: {
  input: AgentMemoryCompletedTurnInput;
  episode: AgentMemoryEpisodeRecord;
  sourceKind: AgentMemorySourceKind;
  role: string;
  key: string;
  textContent?: string;
  summary?: string;
  conversationEntryId: string;
  evidenceUri?: string;
  artifactUri?: string;
  toolName?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): AgentMemorySourceRecord {
  const id = stableMemoryId("src", [
    input.input.sessionId,
    input.input.requestId,
    input.sourceKind,
    input.key,
  ]);
  const createdTime = projectMemoryTime(input.createdAt);
  return {
    id,
    uri: memorySourceUri(id),
    episodeId: input.episode.id,
    episodeUri: input.episode.uri,
    sessionId: input.input.sessionId,
    requestId: input.input.requestId,
    sourceKind: input.sourceKind,
    role: input.role,
    textContent: input.textContent ?? null,
    summary: input.summary ?? null,
    conversationEntryId: input.conversationEntryId,
    evidenceUri: input.evidenceUri ?? "",
    artifactUri: input.artifactUri ?? "",
    toolName: input.toolName ?? "",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    createdAtMs: createdTime.epochMs,
    updatedAtMs: createdTime.epochMs,
    timeZone: createdTime.timeZone,
    localDate: createdTime.localDate,
    localHour: createdTime.localHour,
    metadata: input.metadata ?? {},
  };
}

function projectMemoryEvidenceSource(
  evidence: AgentToolEvidenceMemoryEntryRecord["evidence"][number],
): Record<string, unknown> {
  return compactObject({
    evidenceUri: evidence.evidenceUri,
    kind: evidence.kind,
    locator: evidence.locator,
    display: evidence.display,
    label: evidence.label,
    toolName: evidence.toolName,
    artifactUri: evidence.artifactUri,
    facts: evidence.facts,
    artifactRefs: evidence.artifactRefs,
  });
}
