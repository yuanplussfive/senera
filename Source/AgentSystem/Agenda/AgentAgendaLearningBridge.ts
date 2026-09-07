import crypto from "node:crypto";
import { errorMessage } from "../Core/AgentErrors.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import type { AgentMemoryRecordedTurn } from "../Memory/AgentMemorySourceRepository.js";
import { AgentContinuityEvidenceLinker } from "../Continuity/AgentContinuityEvidenceLinker.js";
import type { AgentContinuityAuthority } from "../Continuity/AgentContinuityDomain.js";
import {
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaAuthority,
  type AgentAgendaDraft,
  type AgentAgendaEventKind,
  type AgentAgendaMutation,
  type AgentAgendaRecordKind,
  type AgentAgendaSnapshot,
} from "./AgentAgendaTypes.js";
import { AgentAgendaService } from "./AgentAgendaService.js";
import { AgentAgendaRecordResolver } from "./AgentAgendaRecordResolver.js";
import { AgentAgendaTimeResolver } from "./AgentAgendaTimeResolver.js";

const MutableKindsByChange = {
  start: [AgentAgendaRecordKinds.Goal, AgentAgendaRecordKinds.Activity, AgentAgendaRecordKinds.Schedule],
  progress: [AgentAgendaRecordKinds.Goal, AgentAgendaRecordKinds.Activity],
  finish: [AgentAgendaRecordKinds.Goal, AgentAgendaRecordKinds.Activity, AgentAgendaRecordKinds.Schedule],
  cancel: [AgentAgendaRecordKinds.Goal, AgentAgendaRecordKinds.Activity, AgentAgendaRecordKinds.Schedule],
} as const satisfies Record<Exclude<AgentAgendaDraft["change"], "create">, readonly AgentAgendaRecordKind[]>;

type CompiledAgendaCommand =
  | {
      readonly operation: "create";
      readonly kind: AgentAgendaRecordKind;
      readonly actor: AgentAgendaDraft["actor"];
      readonly eventKind: AgentAgendaEventKind;
      readonly mutation: Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation;
      readonly sourceRefs: readonly string[];
      readonly authority: AgentAgendaAuthority;
      readonly occurredAt: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly operation: "evolve";
      readonly recordId: string;
      readonly eventKind: AgentAgendaEventKind;
      readonly mutation: AgentAgendaMutation;
      readonly sourceRefs: readonly string[];
      readonly authority: AgentAgendaAuthority;
      readonly occurredAt: string;
      readonly idempotencyKey: string;
    };

export interface AgentAgendaLearningInput {
  readonly drafts: readonly AgentAgendaDraft[];
  readonly recordedTurn: AgentMemoryRecordedTurn;
  readonly timeZone: string;
  readonly now: Date;
  readonly ranking: ResolvedAgentContinuityRecallRankingConfig;
}

export interface AgentAgendaLearningResult {
  readonly recordedCount: number;
  readonly snapshot: AgentAgendaSnapshot;
  readonly accepted: readonly AgentAgendaLearningAccepted[];
  readonly rejected: readonly AgentAgendaLearningRejected[];
}

export type AgentAgendaLearningAcceptedDisposition = "created" | "evolved" | "idempotent";

export interface AgentAgendaLearningAccepted {
  readonly draft: AgentAgendaDraft;
  readonly disposition: AgentAgendaLearningAcceptedDisposition;
  readonly recordId: string;
}

export interface AgentAgendaLearningRejected {
  readonly draft: AgentAgendaDraft;
  readonly disposition: "rejected";
  readonly reason: string;
}

/** Converts shallow learning output into evidence-backed, replay-safe Agenda events. */
export class AgentAgendaLearningBridge {
  private readonly records = new AgentAgendaRecordResolver();
  private readonly time = new AgentAgendaTimeResolver();

  constructor(private readonly agenda: AgentAgendaService) {}

  snapshot(timeZone: string, now: Date): AgentAgendaSnapshot {
    return this.agenda.snapshot(timeZone, now);
  }

  apply(input: AgentAgendaLearningInput): AgentAgendaLearningResult {
    let snapshot = this.agenda.snapshot(input.timeZone, input.now);
    if (input.drafts.length === 0) {
      return { recordedCount: 0, snapshot, accepted: [], rejected: [] };
    }
    const evidence = new AgentContinuityEvidenceLinker(input.ranking);
    const accepted: AgentAgendaLearningAccepted[] = [];
    const rejected: AgentAgendaLearningRejected[] = [];
    for (const draft of input.drafts) {
      let command: CompiledAgendaCommand;
      try {
        command = this.compile(draft, snapshot, input, evidence);
      } catch (error) {
        rejected.push({ draft, disposition: "rejected", reason: errorMessage(error) });
        continue;
      }
      const result =
        command.operation === "create"
          ? this.agenda.record({
              timeZone: input.timeZone,
              kind: command.kind,
              actor: command.actor,
              eventKind: command.eventKind,
              mutation: command.mutation,
              sourceRefs: command.sourceRefs,
              authority: command.authority,
              occurredAt: command.occurredAt,
              idempotencyKey: command.idempotencyKey,
            })
          : this.agenda.evolve(input.timeZone, {
              recordId: command.recordId,
              kind: command.eventKind,
              mutation: command.mutation,
              sourceRefs: command.sourceRefs,
              authority: command.authority,
              occurredAt: command.occurredAt,
              idempotencyKey: command.idempotencyKey,
            });
      snapshot = result.snapshot;
      accepted.push({
        draft,
        disposition:
          result.disposition === "idempotent" ? "idempotent" : command.operation === "create" ? "created" : "evolved",
        recordId: result.record.id,
      });
    }
    return {
      recordedCount: accepted.filter(({ disposition }) => disposition !== "idempotent").length,
      snapshot,
      accepted,
      rejected,
    };
  }

  private compile(
    draft: AgentAgendaDraft,
    snapshot: AgentAgendaSnapshot,
    input: AgentAgendaLearningInput,
    evidenceLinker: AgentContinuityEvidenceLinker,
  ): CompiledAgendaCommand {
    const evidence = evidenceLinker.link(agendaEvidenceText(draft), input.recordedTurn.sources);
    const sourceRefs = evidence.sources.map((source) => source.uri);
    const authority = projectAgendaAuthority(evidence.authority);
    const resolvedTime = draft.timeText
      ? this.time.resolve({
          text: draft.timeText,
          referenceInstant: input.recordedTurn.episode.completedAt,
          timeZone: input.timeZone,
        })
      : undefined;
    const idempotencyKey = createAgendaLearningKey(input.recordedTurn.episode.uri, draft);

    if (draft.change === "create") {
      const equivalent = this.records.findOpenEquivalent(draft, snapshot);
      if (equivalent) {
        return {
          operation: "evolve",
          recordId: equivalent.id,
          eventKind: AgentAgendaEventKinds.EvidenceAttached,
          mutation: {},
          sourceRefs,
          authority,
          occurredAt: input.recordedTurn.episode.completedAt,
          idempotencyKey,
        };
      }
      return this.compileCreate(draft, snapshot, input, resolvedTime, sourceRefs, authority, idempotencyKey);
    }

    if (!(MutableKindsByChange[draft.change] as readonly AgentAgendaRecordKind[]).includes(draft.kind)) {
      throw new Error(`Agenda ${draft.kind} records do not support the ${draft.change} transition.`);
    }
    const target = this.records.resolveMutationTarget(draft, snapshot);
    return {
      operation: "evolve",
      recordId: target.id,
      eventKind: eventKindForChange(draft.change),
      mutation: mutationForChange(draft, resolvedTime),
      sourceRefs,
      authority,
      occurredAt: resolvedTime ?? input.recordedTurn.episode.completedAt,
      idempotencyKey,
    };
  }

  private compileCreate(
    draft: AgentAgendaDraft,
    snapshot: AgentAgendaSnapshot,
    input: AgentAgendaLearningInput,
    resolvedTime: string | undefined,
    sourceRefs: readonly string[],
    authority: AgentAgendaAuthority,
    idempotencyKey: string,
  ): CompiledAgendaCommand {
    const relatedRecordId = draft.relatesTo
      ? this.records.resolveRelatedRecord(draft.relatesTo, snapshot).id
      : undefined;
    const common = {
      operation: "create" as const,
      kind: draft.kind,
      actor: draft.actor,
      sourceRefs,
      authority,
      idempotencyKey,
    };
    if (draft.kind === AgentAgendaRecordKinds.Goal) {
      return {
        ...common,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: draft.summary,
          status: AgentAgendaStatuses.Active,
          intentMode: AgentAgendaIntentModes.Tentative,
          priority: 50,
          progress: 0,
          nextReviewAt: input.recordedTurn.episode.completedAt,
          ownerSessionId: input.recordedTurn.episode.sessionId,
          ...(resolvedTime ? { dueAt: resolvedTime } : {}),
          ...(relatedRecordId ? { relatedRecordId } : {}),
        },
        occurredAt: input.recordedTurn.episode.completedAt,
      };
    }
    if (draft.kind === AgentAgendaRecordKinds.Schedule) {
      if (!resolvedTime) throw new Error(`Agenda schedule requires a source-backed time expression: ${draft.summary}`);
      return {
        ...common,
        eventKind: AgentAgendaEventKinds.Declared,
        mutation: {
          summary: draft.summary,
          status: AgentAgendaStatuses.Planned,
          dueAt: resolvedTime,
          ...(relatedRecordId ? { relatedRecordId } : {}),
        },
        occurredAt: input.recordedTurn.episode.completedAt,
      };
    }
    if (draft.kind === AgentAgendaRecordKinds.Activity) {
      const startedAt = resolvedTime ?? input.recordedTurn.episode.completedAt;
      return {
        ...common,
        eventKind: AgentAgendaEventKinds.Started,
        mutation: {
          summary: draft.summary,
          status: AgentAgendaStatuses.Active,
          startsAt: startedAt,
          ...(relatedRecordId ? { relatedRecordId } : {}),
        },
        occurredAt: startedAt,
      };
    }
    const occurredAt = resolvedTime ?? input.recordedTurn.episode.completedAt;
    return {
      ...common,
      eventKind: AgentAgendaEventKinds.Occurred,
      mutation: {
        summary: draft.summary,
        status: AgentAgendaStatuses.Recorded,
        ...(relatedRecordId ? { relatedRecordId } : {}),
      },
      occurredAt,
    };
  }
}

function eventKindForChange(change: Exclude<AgentAgendaDraft["change"], "create">): AgentAgendaEventKind {
  const kinds = {
    start: AgentAgendaEventKinds.Started,
    progress: AgentAgendaEventKinds.Progressed,
    finish: AgentAgendaEventKinds.Finished,
    cancel: AgentAgendaEventKinds.Cancelled,
  } as const satisfies Record<Exclude<AgentAgendaDraft["change"], "create">, AgentAgendaEventKind>;
  return kinds[change];
}

function mutationForChange(draft: AgentAgendaDraft, occurredAt: string | undefined): AgentAgendaMutation {
  if (draft.change === "start") {
    return {
      status: AgentAgendaStatuses.Active,
      detail: draft.summary,
      ...(draft.kind === AgentAgendaRecordKinds.Activity && occurredAt ? { startsAt: occurredAt } : {}),
    };
  }
  if (draft.change === "progress") return { detail: draft.summary };
  if (draft.change === "finish") {
    return {
      status: AgentAgendaStatuses.Completed,
      detail: draft.summary,
      ...(draft.kind === AgentAgendaRecordKinds.Activity && occurredAt ? { endsAt: occurredAt } : {}),
    };
  }
  if (draft.change === "cancel") {
    return { status: AgentAgendaStatuses.Cancelled, detail: draft.summary };
  }
  throw new Error(`Agenda mutation cannot compile create as an evolution: ${draft.summary}`);
}

function agendaEvidenceText(draft: AgentAgendaDraft): string {
  return [draft.summary, draft.timeText, draft.relatesTo].filter(Boolean).join("\n");
}

function projectAgendaAuthority(authority: AgentContinuityAuthority): AgentAgendaAuthority {
  const mapping = {
    user_explicit: AgentAgendaAuthorities.UserExplicit,
    tool_verified: AgentAgendaAuthorities.ToolVerified,
    system_observed: AgentAgendaAuthorities.Host,
    model_inferred: AgentAgendaAuthorities.Host,
  } as const satisfies Record<AgentContinuityAuthority, AgentAgendaAuthority>;
  return mapping[authority];
}

function createAgendaLearningKey(episodeUri: string, draft: AgentAgendaDraft): string {
  return `agenda_learning_${crypto
    .createHash("sha256")
    .update(JSON.stringify([episodeUri, draft]))
    .digest("hex")}`;
}
