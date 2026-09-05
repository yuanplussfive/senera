import { AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import type {
  AgentWorldResidentWakeActionInput,
  AgentWorldResidentWakeActionPort,
  AgentWorldResidentWakeActionResult,
} from "./AgentWorldResidentWakeRuntime.js";

/** Records an explicit Resident wake as a durable world event. */
export class AgentWorldResidentWakeEventActionPort implements AgentWorldResidentWakeActionPort {
  constructor(
    private readonly options: {
      readonly ledger: AgentWorldEventLedger;
      readonly timeZone: () => string;
    },
  ) {}

  async execute(input: AgentWorldResidentWakeActionInput): Promise<AgentWorldResidentWakeActionResult> {
    const event = this.options.ledger.append({
      worldId: input.worldId,
      timeZone: this.options.timeZone(),
      subject: { id: input.request.id, kind: "event" },
      type: "resident.explicit_wake",
      summary: input.request.reason,
      changes: [],
      evidenceRefs: [`resident-wake:${input.request.id}`],
      occurredAt: input.now.toString(),
      idempotencyKey: `resident-wake:event:${input.request.id}`,
    });
    return {
      evidenceRefs: [event.uri],
      result: {
        eventId: event.id,
        requestId: input.request.id,
        payload: input.request.payload,
      },
    };
  }
}
