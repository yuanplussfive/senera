import { compactObject } from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { memorySourceUri, stableMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import { previewAgentText } from "../Text/AgentTextProjection.js";
import type {
  AgentMemoryCompletedTurnInput,
  AgentMemoryEpisodeRecord,
  AgentMemorySourceKind,
  AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";
import { terminalText } from "./AgentMemoryTerminalText.js";
import type { ToolArtifactEvidenceRecord } from "../Types/ToolRuntimeTypes.js";

const MemorySourceTextLimits = {
  textContentChars: 4_000,
  summaryChars: 2_000,
  factChars: 1_000,
} as const;

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
      summary: input.userEntry.content,
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
  for (const result of input.executedTools) {
    const artifact = result.artifact;
    if (!artifact) continue;

    if (artifact.artifactUri) {
      artifactSources.set(
        artifact.artifactUri,
        buildSource({
          input,
          episode,
          sourceKind: "artifact",
          role: "tool",
          key: artifact.artifactUri,
          conversationEntryId: input.assistantEntry.id,
          artifactUri: artifact.artifactUri,
          toolName: result.name,
          createdAt: input.completedAt,
          metadata: { callId: result.callId },
        }),
      );
    }

    for (const evidence of artifact.evidence) {
      sources.push(
        buildSource({
          input,
          episode,
          sourceKind: "tool_evidence",
          role: "tool",
          key: evidence.evidenceUri,
          summary: evidence.display || evidence.label || evidence.kind,
          conversationEntryId: input.assistantEntry.id,
          evidenceUri: evidence.evidenceUri,
          artifactUri: evidence.plannerMemory.artifactUri ?? artifact.artifactUri,
          toolName: result.name,
          createdAt: input.completedAt,
          metadata: {
            callId: result.callId,
            evidence: projectMemoryEvidenceSource(evidence),
          },
        }),
      );
    }
  }

  return uniqueSourcesByUri([...sources, ...artifactSources.values()]);
}

function uniqueSourcesByUri(sources: readonly AgentMemorySourceRecord[]): AgentMemorySourceRecord[] {
  const byUri = new Map<string, AgentMemorySourceRecord>();
  for (const source of sources) {
    if (!byUri.has(source.uri)) {
      byUri.set(source.uri, source);
    }
  }
  return [...byUri.values()];
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
  const id = stableMemoryId("src", [input.input.sessionId, input.input.requestId, input.sourceKind, input.key]);
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
    textContent: input.textContent
      ? previewAgentText(input.textContent, MemorySourceTextLimits.textContentChars)
      : null,
    summary: input.summary ? previewAgentText(input.summary, MemorySourceTextLimits.summaryChars) : null,
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

function projectMemoryEvidenceSource(evidence: ToolArtifactEvidenceRecord): Record<string, unknown> {
  return compactObject({
    evidenceUri: evidence.evidenceUri,
    kind: evidence.kind,
    locator: evidence.locator,
    display: evidence.display,
    label: evidence.label,
    artifactUri: evidence.plannerMemory.artifactUri,
    facts: evidence.plannerMemory.facts.map((fact) => ({
      name: fact.name,
      value: previewAgentText(fact.value, MemorySourceTextLimits.factChars),
    })),
    artifactRefs: evidence.plannerMemory.artifactRefs,
  });
}
