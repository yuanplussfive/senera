import { Temporal } from "@js-temporal/polyfill";
import type { AgentAgendaService } from "../Agenda/AgentAgendaService.js";
import type { ResolvedAgentWorldConfig } from "../Types/AgentRuntimeConfigTypes.js";
import type { AgentHabitScheduler } from "./AgentHabitScheduler.js";
import type { AgentResidentStateMachine } from "./AgentResidentStateMachine.js";
import type { AgentWorldClock } from "./AgentWorldClock.js";
import type { AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import { AgentWorldGraphView } from "./AgentWorldGraphView.js";
import type { AgentWorldMaterializer } from "./AgentWorldMaterializer.js";
import { AgentHabitDefinitionKinds } from "./AgentHabitScheduler.js";
import { AgentWorldActionSourceIds, AgentWorldWakeBudget } from "./AgentWorldActionBudget.js";
import type { AgentWorldWorkLedger } from "./AgentWorldWorkLedger.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import { secondsToMilliseconds } from "../Defaults/AgentTimeDefaults.js";
import type {
  AgentWorldSnapshotProvider,
  AgentWorldTreeProjection,
  AgentWorldWakeResult,
  AgentWorldWakeSource,
} from "./AgentWorldTypes.js";

export type AgentWorldAdvanceSink = (snapshot: AgentWorldTreeProjection) => void | Promise<void>;

interface AgentWorldAdvanceResult {
  readonly worldId: string;
  readonly from: Temporal.Instant;
  readonly to: Temporal.Instant;
}

const MaximumTimerDelayMilliseconds = 2_147_483_647;

/** Coordinates the world clock, habits, materializer, and exact next-wake lifecycle. */
export class AgentWorldRuntime implements AgentWorldSnapshotProvider {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sink: AgentWorldAdvanceSink | undefined;
  private advancing = false;
  private wakeInFlight: Promise<AgentWorldTreeProjection> | undefined;
  private pendingWakeAt: Temporal.Instant | undefined;
  private wakeBlocked = false;
  private deferredWakeAt: Temporal.Instant | undefined;

  constructor(
    private readonly options: {
      readonly agenda: AgentAgendaService;
      readonly ledger: AgentWorldEventLedger;
      readonly clock: AgentWorldClock;
      readonly habits: AgentHabitScheduler;
      readonly residentStates: AgentResidentStateMachine;
      readonly materializer: AgentWorldMaterializer;
      readonly config: () => ResolvedAgentWorldConfig;
      readonly now?: () => Temporal.Instant;
      readonly errorSink: (error: unknown) => void;
      readonly wakeSources?: readonly AgentWorldWakeSource[];
      readonly workLedger?: AgentWorldWorkLedger;
      readonly inferenceBudget?: AgentInferenceBudgetPort;
      readonly inferenceBudgetScope?: () => string;
    },
  ) {}

  get events(): AgentWorldEventLedger {
    return this.options.ledger;
  }

  get habits(): AgentHabitScheduler {
    return this.options.habits;
  }

  get residentStates(): AgentResidentStateMachine {
    return this.options.residentStates;
  }

  snapshot(now: Temporal.Instant = this.options.now?.() ?? Temporal.Now.instant()): AgentWorldTreeProjection {
    this.advance(now);
    const snapshot = this.project(now);
    if (this.sink) this.scheduleNextWake(now);
    return snapshot;
  }

  graph(now?: Temporal.Instant): AgentWorldGraphView {
    return new AgentWorldGraphView(this.snapshot(now));
  }

  /** Processes one world wake and coalesces concurrent callers into one pass. */
  wake(now: Temporal.Instant = this.options.now?.() ?? Temporal.Now.instant()): Promise<AgentWorldTreeProjection> {
    if (this.wakeInFlight) {
      this.pendingWakeAt = laterInstant(this.pendingWakeAt, now);
      return this.wakeInFlight;
    }
    this.wakeBlocked = false;
    this.pendingWakeAt = undefined;
    const operation = this.performWake(now);
    this.wakeInFlight = operation;
    void operation.then(
      () => {
        if (this.wakeInFlight === operation) this.wakeInFlight = undefined;
      },
      () => {
        if (this.wakeInFlight === operation) this.wakeInFlight = undefined;
      },
    );
    return operation;
  }

  start(sink: AgentWorldAdvanceSink): void {
    if (this.sink) throw new Error("World runtime has already started.");
    this.wakeBlocked = false;
    this.sink = sink;
    const snapshot = this.snapshot();
    void Promise.resolve(sink(snapshot)).catch(this.options.errorSink);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.sink = undefined;
  }

  private advance(now: Temporal.Instant): AgentWorldAdvanceResult {
    if (this.advancing) throw new Error("World runtime advance is not reentrant.");
    this.advancing = true;
    try {
      const config = this.options.config();
      const agenda = this.options.agenda.snapshot(config.TimeZone, new Date(now.epochMilliseconds));
      const world = agenda.world;
      const clockState = this.options.clock.state(world.id);
      const from = clockState?.lastAdvancedAt ?? now;
      // Habit effects are wake-source work; clock advancement must not
      // execute them as a side effect of reading a snapshot.
      this.refreshClock({ worldId: world.id, now });
      return { worldId: world.id, from, to: now };
    } finally {
      this.advancing = false;
    }
  }

  private project(now: Temporal.Instant): AgentWorldTreeProjection {
    const config = this.options.config();
    const world = this.options.agenda.snapshot(config.TimeZone, new Date(now.epochMilliseconds)).world;
    const sourceSchedules = (this.options.wakeSources ?? []).flatMap((source) => {
      try {
        return source.upcomingSchedules({ worldId: world.id, after: now });
      } catch (error) {
        this.options.errorSink(error);
        return [];
      }
    });
    return this.options.materializer.materialize(now, [
      ...this.options.habits.upcoming(world.id, now, AgentHabitDefinitionKinds.Habit),
      ...sourceSchedules,
    ]);
  }

  private scheduleNextWake(referenceNow: Temporal.Instant = this.options.now?.() ?? Temporal.Now.instant()): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const config = this.options.config();
    const world = this.options.agenda.snapshot(config.TimeZone, new Date(referenceNow.epochMilliseconds)).world;
    const clock = this.options.clock.state(world.id);
    if (!clock || !this.sink || this.wakeBlocked) return;
    const remaining = Number(clock.nextWakeAt.epochMilliseconds - referenceNow.epochMilliseconds);
    const delay = Math.min(Math.max(0, remaining), MaximumTimerDelayMilliseconds);
    this.timer = setTimeout(() => void this.wake().catch(this.options.errorSink), delay);
    this.timer.unref?.();
  }

  private async performWake(now: Temporal.Instant): Promise<AgentWorldTreeProjection> {
    this.timer = undefined;
    const sink = this.sink;
    let currentNow = now;
    try {
      let snapshot = await this.performWakePass(currentNow, sink);
      while (true) {
        const pending = this.pendingWakeAt;
        this.pendingWakeAt = undefined;
        if (!pending || Temporal.Instant.compare(pending, currentNow) <= 0) return snapshot;
        currentNow = pending;
        snapshot = await this.performWakePass(currentNow, sink);
      }
    } catch (error) {
      this.wakeBlocked = true;
      throw error;
    } finally {
      this.pendingWakeAt = undefined;
      if (this.sink === sink) this.scheduleNextWake(currentNow);
    }
  }

  private async performWakePass(
    now: Temporal.Instant,
    sink: AgentWorldAdvanceSink | undefined,
  ): Promise<AgentWorldTreeProjection> {
    const config = this.options.config();
    const advancement = this.advance(now);
    this.options.workLedger?.recoverExpired(advancement.to);
    const orderedSources = orderWakeSources(this.options.wakeSources ?? [], config.ActionBudget?.SourceOrder ?? []);
    const actionBudget = config.ActionBudget
      ? new AgentWorldWakeBudget(
          {
            maxActionsPerWake: config.ActionBudget.MaxActionsPerWake,
            maxDecisionCandidatesPerWake: config.ActionBudget.MaxDecisionCandidatesPerWake,
            retryDelayMs: secondsToMilliseconds(config.ActionBudget.RetryDelaySeconds),
            fairShare: config.ActionBudget.FairShare,
            sourceCaps: config.ActionBudget.SourceCaps,
          },
          advancement.to,
          orderedSources
            .filter((source) => source.fairShareEligible !== false)
            .map((source) => source.sourceId)
            .filter((sourceId): sourceId is string => sourceId !== undefined),
        )
      : undefined;
    let snapshot = this.project(advancement.to);
    if (sink) await sink(snapshot);
    let changed = false;
    for (const source of orderedSources) {
      let result: AgentWorldWakeResult;
      try {
        result = await source.onWake({
          worldId: advancement.worldId,
          from: advancement.from,
          to: advancement.to,
          snapshot,
          ...(actionBudget ? { budget: actionBudget } : {}),
          ...(this.options.inferenceBudget
            ? {
                inferenceBudget: this.options.inferenceBudget,
                ...(this.options.inferenceBudgetScope
                  ? { inferenceBudgetScope: this.options.inferenceBudgetScope() }
                  : {}),
              }
            : {}),
        });
      } catch (error) {
        this.options.errorSink(error);
        if (actionBudget && source.sourceId) actionBudget.defer(source.sourceId);
        continue;
      }
      if (typeof result.changed !== "boolean") {
        throw new Error("World wake source must return a boolean changed result.");
      }
      changed = result.changed || changed;
      if (result.changed) snapshot = this.project(advancement.to);
      let remaining: ReturnType<AgentWorldWakeSource["wakePlan"]>;
      try {
        remaining = source.wakePlan({ worldId: advancement.worldId, after: advancement.to });
      } catch (error) {
        this.options.errorSink(error);
        if (actionBudget && source.sourceId) actionBudget.defer(source.sourceId);
        continue;
      }
      if (remaining.due && !result.changed && !actionBudget?.hasDeferredWork) {
        throw new Error("World wake source left due work unresolved without making progress.");
      }
    }
    if (actionBudget?.deferredUntil) {
      this.deferredWakeAt = laterInstant(this.deferredWakeAt, actionBudget.deferredUntil);
    } else if (this.deferredWakeAt && Temporal.Instant.compare(this.deferredWakeAt, advancement.to) <= 0) {
      this.deferredWakeAt = undefined;
    }
    if (changed && sink) await sink(snapshot);
    this.refreshClock({ worldId: advancement.worldId, now: advancement.to });
    return snapshot;
  }

  private refreshClock(input: {
    readonly worldId: string;
    readonly now: Temporal.Instant;
    readonly additionalWakeInstants?: readonly Temporal.Instant[];
  }): void {
    const config = this.options.config();
    const agenda = this.options.agenda.snapshot(config.TimeZone, new Date(input.now.epochMilliseconds));
    const wakeSources = this.options.wakeSources ?? [];
    const hasHabitSource = wakeSources.some((source) => source.sourceId === AgentWorldActionSourceIds.Habit);
    const normalPlan = hasHabitSource
      ? { due: false, instants: [] as readonly Temporal.Instant[] }
      : this.options.habits.evaluationWakePlan(input.worldId, input.now, AgentHabitDefinitionKinds.Habit);
    const sourcePlans = wakeSources.flatMap((source) => {
      try {
        return [source.wakePlan({ worldId: input.worldId, after: input.now })];
      } catch (error) {
        this.options.errorSink(error);
        const retryDelayMs = config.ActionBudget
          ? secondsToMilliseconds(config.ActionBudget.RetryDelaySeconds)
          : undefined;
        if (retryDelayMs !== undefined) {
          this.deferredWakeAt = laterInstant(this.deferredWakeAt, input.now.add({ milliseconds: retryDelayMs }));
        }
        return [];
      }
    });
    const deferred = this.deferredWakeAt && Temporal.Instant.compare(this.deferredWakeAt, input.now) > 0;
    if (this.deferredWakeAt && !deferred) this.deferredWakeAt = undefined;
    this.options.clock.advance({
      worldId: input.worldId,
      timeZone: config.TimeZone,
      dayPhases: config.DayPhases.map((phase) => ({
        id: phase.Id,
        label: phase.Label,
        startsAt: phase.StartsAt,
        endsAt: phase.EndsAt,
      })),
      now: input.now,
      wakeRequired: !deferred && (normalPlan.due || sourcePlans.some((plan) => plan.due)),
      additionalWakeInstants: [
        ...(input.additionalWakeInstants ?? []),
        ...normalPlan.instants,
        ...sourcePlans.flatMap((plan) => plan.instants),
        ...(deferred && this.deferredWakeAt ? [this.deferredWakeAt] : []),
        ...agenda.upcoming.flatMap((record) => {
          const scheduledAt = record.dueAt ?? record.startsAt;
          if (!scheduledAt) return [];
          const instant = Temporal.Instant.from(scheduledAt);
          return Temporal.Instant.compare(instant, input.now) > 0 ? [instant] : [];
        }),
      ],
    });
  }
}

function orderWakeSources(
  sources: readonly AgentWorldWakeSource[],
  sourceOrder: readonly string[],
): AgentWorldWakeSource[] {
  const ranks = new Map(sourceOrder.map((sourceId, index) => [sourceId, index] as const));
  return sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) =>
      left.source.sourceId && right.source.sourceId
        ? (ranks.get(left.source.sourceId) ?? ranks.size) - (ranks.get(right.source.sourceId) ?? ranks.size) ||
          left.source.sourceId.localeCompare(right.source.sourceId)
        : left.index - right.index,
    )
    .map(({ source }) => source);
}

function laterInstant(current: Temporal.Instant | undefined, candidate: Temporal.Instant): Temporal.Instant {
  return !current || Temporal.Instant.compare(candidate, current) > 0 ? candidate : current;
}
