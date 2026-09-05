import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type { AgentTemporalMemorySqliteStore } from "../TemporalMemory/AgentTemporalMemorySqliteStore.js";
import type { AgentTemporalMemoryDigest } from "../TemporalMemory/AgentTemporalMemoryTypes.js";
import type { AgentWorldEvent, AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentMemoryDeletionSink } from "../Memory/AgentMemoryService.js";

const ConversationSegmentCompletedEvent = "conversation.segment.completed";

/** Projects sealed conversation segments into the physical world timeline without inventing state changes. */
export class AgentTemporalMemoryWorldBridge implements AgentMemoryDeletionSink {
  constructor(
    private readonly options: {
      readonly store: AgentTemporalMemorySqliteStore;
      readonly ledger: AgentWorldEventLedger;
      readonly agenda: AgentAgendaService;
      readonly timeZone: () => string;
    },
  ) {}

  observe(digest: AgentTemporalMemoryDigest): AgentWorldEvent | undefined {
    if (digest.granularity !== "segment") return undefined;
    if (digest.status !== "sealed") throw new Error(`World timeline received an unsealed digest: ${digest.uri}`);
    const timeZone = this.options.timeZone();
    const world = this.options.agenda.snapshot(timeZone).world;
    const evidenceRefs = this.options.store.members(digest.id).map((member) => member.memberUri);
    if (evidenceRefs.length === 0) throw new Error(`Temporal digest has no traceable evidence: ${digest.uri}`);
    this.options.ledger.deleteDerivedEvents({
      worldId: world.id,
      eventType: ConversationSegmentCompletedEvent,
      subjectIds: [digest.uri],
    });
    return this.options.ledger.append({
      worldId: world.id,
      timeZone,
      subject: { id: digest.uri, kind: "conversation" },
      type: ConversationSegmentCompletedEvent,
      summary: digest.summary,
      changes: [],
      evidenceRefs,
      occurredAt: digest.periodEnd,
      recordedAt: digest.updatedAt,
      idempotencyKey: `${digest.uri}:${digest.sourceRevision}`,
    });
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    const timeZone = this.options.timeZone();
    const world = this.options.agenda.snapshot(timeZone).world;
    if (impact.episodeUris.length === 0) return;
    this.options.ledger.deleteDerivedEvents({
      worldId: world.id,
      eventType: ConversationSegmentCompletedEvent,
      evidenceRefs: impact.episodeUris,
    });
  }
}
