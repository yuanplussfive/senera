import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../Agenda/AgentAgendaTypes.js";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import {
  AgentWorldResidentIdleDecisionKinds,
  type AgentWorldResidentIdleActionInput,
  type AgentWorldResidentIdleActionPort,
  type AgentWorldResidentIdleActionResult,
} from "./AgentWorldResidentIdleRuntime.js";

export interface AgentWorldResidentIdleDeliveryPort {
  deliver(input: {
    readonly sessionId: string;
    readonly deliveryId: string;
    readonly content: string;
    readonly createdAt: string;
  }): Promise<"delivered" | "busy" | "missing">;
}

/** Host-owned effects for typed idle decisions. No model output reaches tools directly. */
export class AgentWorldResidentIdleAgendaActionPort implements AgentWorldResidentIdleActionPort {
  constructor(
    private readonly options: {
      readonly agenda: AgentAgendaService;
      readonly timeZone: () => string;
      readonly resolveTargetSession: () => string | undefined | Promise<string | undefined>;
      readonly delivery?: AgentWorldResidentIdleDeliveryPort;
    },
  ) {}

  async execute(input: AgentWorldResidentIdleActionInput): Promise<AgentWorldResidentIdleActionResult> {
    switch (input.decision.kind) {
      case AgentWorldResidentIdleDecisionKinds.Reflect:
        return this.reflect(input);
      case AgentWorldResidentIdleDecisionKinds.CreateGoal:
        return this.createGoal(input);
      case AgentWorldResidentIdleDecisionKinds.Notify:
        return this.notify(input);
      case AgentWorldResidentIdleDecisionKinds.Wait:
        throw new Error("Resident idle wait decisions must be handled by the runtime.");
    }
  }

  private reflect(input: AgentWorldResidentIdleActionInput): AgentWorldResidentIdleActionResult {
    const result = this.options.agenda.record({
      timeZone: this.options.timeZone(),
      kind: AgentAgendaRecordKinds.Event,
      actor: AgentAgendaActorRoles.Resident,
      eventKind: AgentAgendaEventKinds.Occurred,
      mutation: {
        summary: input.decision.reason,
        status: AgentAgendaStatuses.Recorded,
        detail: input.decision.reason,
      },
      sourceRefs: [`world-work:${input.workItemId}`],
      authority: AgentAgendaAuthorities.Host,
      idempotencyKey: `resident-idle:reflect:${input.workItemId}`,
      occurredAt: input.now.toString(),
    });
    return {
      changed: result.disposition === "created",
      evidenceRefs: [result.record.uri],
      result: { recordId: result.record.id },
    };
  }

  private async createGoal(input: AgentWorldResidentIdleActionInput): Promise<AgentWorldResidentIdleActionResult> {
    const proposal = input.decision.goal;
    if (!proposal) throw new Error("Resident idle create_goal decision requires a goal proposal.");
    const summary = requireText(proposal.summary, "Resident idle goal summary");
    const successCriteria =
      proposal.successCriteria?.map((criterion) => requireText(criterion, "Resident idle success criterion")) ?? [];
    const ownerSessionId = await this.options.resolveTargetSession();
    const result = this.options.agenda.record({
      timeZone: this.options.timeZone(),
      kind: AgentAgendaRecordKinds.Goal,
      actor: AgentAgendaActorRoles.Resident,
      eventKind: AgentAgendaEventKinds.Declared,
      mutation: {
        summary,
        status: AgentAgendaStatuses.Active,
        intentMode: AgentAgendaIntentModes.Committed,
        priority: normalizePriority(proposal.priority),
        progress: 0,
        successCriteria,
        detail: proposal.detail?.trim() || null,
        ...(ownerSessionId ? { ownerSessionId } : {}),
        nextReviewAt: input.now.toString(),
      },
      sourceRefs: [`world-work:${input.workItemId}`],
      authority: AgentAgendaAuthorities.Host,
      idempotencyKey: `resident-idle:goal:${input.workItemId}`,
      occurredAt: input.now.toString(),
    });
    return {
      changed: result.disposition === "created",
      evidenceRefs: [result.record.uri],
      result: { goalId: result.record.id },
    };
  }

  private async notify(input: AgentWorldResidentIdleActionInput): Promise<AgentWorldResidentIdleActionResult> {
    const message = requireText(input.decision.message, "Resident idle notification message");
    if (!this.options.delivery) throw new Error("Resident idle notifications require a delivery port.");
    const sessionId = await this.options.resolveTargetSession();
    if (!sessionId) {
      return { changed: false, evidenceRefs: [], result: { status: "blocked", reason: "no_eligible_session" } };
    }
    const status = await this.options.delivery.deliver({
      sessionId,
      deliveryId: `resident-idle:${input.workItemId}`,
      content: message,
      createdAt: input.now.toString(),
    });
    if (status === "busy") throw new Error(`Resident idle notification target is busy: ${sessionId}`);
    return {
      changed: status === "delivered",
      evidenceRefs: status === "delivered" ? [`session-delivery:${input.workItemId}`] : [],
      result: { status, sessionId },
    };
  }
}

function normalizePriority(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new RangeError("Resident idle goal priority must be an integer between 0 and 100.");
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  return value.trim();
}
