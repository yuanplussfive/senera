import type { AgentAgendaDraft, AgentAgendaRecord, AgentAgendaSnapshot } from "./AgentAgendaTypes.js";

/** Resolves model-facing summaries to host-owned records without fuzzy identity guesses. */
export class AgentAgendaRecordResolver {
  resolveMutationTarget(draft: AgentAgendaDraft, snapshot: AgentAgendaSnapshot): AgentAgendaRecord {
    const reference = draft.relatesTo ?? draft.summary;
    return this.requireUnique(reference, snapshot.records, (record) => {
      return record.kind === draft.kind && record.actor.role === draft.actor;
    });
  }

  resolveRelatedRecord(reference: string, snapshot: AgentAgendaSnapshot): AgentAgendaRecord {
    return this.requireUnique(reference, snapshot.records, () => true);
  }

  findOpenEquivalent(draft: AgentAgendaDraft, snapshot: AgentAgendaSnapshot): AgentAgendaRecord | undefined {
    const candidates = this.matching(draft.summary, snapshot.records).filter(
      (record) =>
        record.kind === draft.kind &&
        record.actor.role === draft.actor &&
        record.status !== "completed" &&
        record.status !== "cancelled" &&
        record.status !== "recorded",
    );
    if (candidates.length > 1) {
      throw new Error(`Agenda record reference is ambiguous: ${draft.summary}`);
    }
    return candidates[0];
  }

  private requireUnique(
    reference: string,
    records: readonly AgentAgendaRecord[],
    accepts: (record: AgentAgendaRecord) => boolean,
  ): AgentAgendaRecord {
    const candidates = this.matching(reference, records).filter(accepts);
    if (candidates.length === 0) {
      throw new Error(`Agenda record reference does not match the active world: ${reference}`);
    }
    if (candidates.length > 1) {
      throw new Error(`Agenda record reference is ambiguous: ${reference}`);
    }
    return candidates[0]!;
  }

  private matching(reference: string, records: readonly AgentAgendaRecord[]): AgentAgendaRecord[] {
    const normalized = normalizeSummary(reference);
    return records.filter((record) => normalizeSummary(record.summary) === normalized);
  }
}

function normalizeSummary(value: string): string {
  return value.trim().replace(/\s+/gu, " ").normalize("NFKC").toLocaleLowerCase();
}
