import type { AgentMemoryCompletedTurnSink, AgentMemoryDeletionSink } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryDeletionImpact, AgentMemoryRecordedTurn } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type { AgentWorldEvent, AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import {
  createAgentTextParts,
  identityPart,
  renderAgentTextParts,
  textPart,
  type AgentTextParts,
} from "../Text/AgentTextParts.js";

const ConversationTurnCompletedEvent = "conversation.turn.completed";

/**
 * Projects committed conversation turns into the physical world timeline.
 * It consumes already persisted sources and never asks a model to invent an event.
 */
export class AgentWorldConversationBridge implements AgentMemoryCompletedTurnSink, AgentMemoryDeletionSink {
  constructor(
    private readonly options: {
      readonly ledger: AgentWorldEventLedger;
      readonly agenda: AgentAgendaService;
      readonly timeZone: () => string;
      readonly onChanged?: () => void;
    },
  ) {}

  recordCompletedTurn(recordedTurn: AgentMemoryRecordedTurn): AgentWorldEvent {
    const timeZone = this.options.timeZone();
    const world = this.options.agenda.snapshot(timeZone, new Date(recordedTurn.episode.completedAtMs)).world;
    const evidenceRefs = [recordedTurn.episode.uri, ...recordedTurn.sources.map((source) => source.uri)];
    const summaryParts = projectConversationSummary(recordedTurn);
    const event = this.options.ledger.append({
      worldId: world.id,
      timeZone,
      subject: { id: recordedTurn.episode.uri, kind: "conversation" },
      type: ConversationTurnCompletedEvent,
      summary: renderAgentTextParts(summaryParts),
      summaryParts,
      changes: [],
      evidenceRefs,
      occurredAt: recordedTurn.episode.completedAt,
      recordedAt: recordedTurn.episode.completedAt,
      idempotencyKey: `conversation-turn:${recordedTurn.episode.uri}`,
    });
    this.options.onChanged?.();
    return event;
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    const evidenceRefs = [...new Set([...impact.episodeUris, ...impact.sourceUris])];
    if (evidenceRefs.length === 0) return;
    const timeZone = this.options.timeZone();
    const world = this.options.agenda.snapshot(timeZone).world;
    const deleted = this.options.ledger.deleteDerivedEvents({
      worldId: world.id,
      eventType: ConversationTurnCompletedEvent,
      evidenceRefs,
    });
    if (deleted > 0) this.options.onChanged?.();
  }
}

function projectConversationSummary(recordedTurn: AgentMemoryRecordedTurn): AgentTextParts {
  const user = requireSourceSummary(recordedTurn, "user_message");
  const resident = requireSourceSummary(recordedTurn, "assistant_final");
  return createAgentTextParts([
    identityPart("user"),
    textPart(`：${user}\n`),
    identityPart("resident"),
    textPart(`：${resident}`),
  ]);
}

function requireSourceSummary(
  recordedTurn: AgentMemoryRecordedTurn,
  sourceKind: "user_message" | "assistant_final",
): string {
  const summary = recordedTurn.sources.find((source) => source.sourceKind === sourceKind)?.summary;
  if (!summary) throw new Error(`Completed turn is missing its ${sourceKind} source summary.`);
  return summary;
}
