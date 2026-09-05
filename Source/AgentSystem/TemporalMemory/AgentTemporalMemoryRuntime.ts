import crypto from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type {
  AgentMemoryDeletionImpact,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";
import { stableMemoryId } from "../Memory/AgentMemoryIdentity.js";
import type { AgentMemoryDeletionSink } from "../Memory/AgentMemoryService.js";
import { projectAgentTemporalMemoryScope } from "./AgentTemporalMemoryIdentity.js";
import { agentTemporalMemoryCalendarPeriod, agentTemporalMemoryDayBoundary } from "./AgentTemporalMemoryPeriod.js";
import {
  type AgentTemporalMemoryMemberInput,
  AgentTemporalMemorySqliteStore,
} from "./AgentTemporalMemorySqliteStore.js";
import { projectAgentTemporalMemorySummaryInput } from "./AgentTemporalMemorySummaryProjector.js";
import { projectAgentConversationBoundaryInput } from "./AgentConversationBoundaryProjector.js";
import type {
  AgentConversationBoundaryClient,
  AgentConversationSegmentDecision,
  AgentTemporalMemoryDigest,
  AgentTemporalMemoryIdentity,
  AgentTemporalMemoryRuntimePolicy,
  AgentTemporalMemoryScope,
  AgentTemporalMemorySummaryClient,
} from "./AgentTemporalMemoryTypes.js";

const MaximumTimerDelayMilliseconds = 2_147_483_647;

export type AgentTemporalMemoryDigestSink = (digest: AgentTemporalMemoryDigest) => void | Promise<void>;

/** Builds recoverable segment/day/month summaries over immutable physical conversation evidence. */
export class AgentTemporalMemoryRuntime implements AgentMemoryDeletionSink {
  private readonly scope: AgentTemporalMemoryScope;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private drainRequested = false;
  private started = false;
  private stopped = false;
  private sink: AgentTemporalMemoryDigestSink | undefined;

  constructor(
    private readonly options: {
      readonly store: AgentTemporalMemorySqliteStore;
      readonly sources: AgentMemorySourceRepository;
      readonly identity: AgentTemporalMemoryIdentity;
      readonly timeZone: () => string;
      readonly policy: () => AgentTemporalMemoryRuntimePolicy;
      readonly boundaryClient: () => AgentConversationBoundaryClient;
      readonly boundaryAnchors?: () => readonly string[];
      readonly summaryClient: () => AgentTemporalMemorySummaryClient;
      readonly now?: () => Temporal.Instant;
      readonly logger?: AgentLogger;
    },
  ) {
    this.scope = projectAgentTemporalMemoryScope(options.identity);
  }

  setDigestSink(sink: AgentTemporalMemoryDigestSink): void {
    this.sink = sink;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    if (!this.options.policy().enabled) return;
    this.synchronizePhysicalHistory();
    this.kick();
  }

  recordTurn(recordedTurn: AgentMemoryRecordedTurn): void {
    if (!this.options.policy().enabled) return;
    this.enqueueTurn(recordedTurn);
    if (this.started) this.kick();
  }

  async flush(): Promise<void> {
    if (!this.options.policy().enabled) return;
    await this.drain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  deleteSession(sessionId: string): void {
    this.options.store.deleteSession(sessionId);
    if (this.started) this.kick();
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    const changed = this.options.store.invalidateEpisodes(impact.episodeUris, this.now().toString());
    if (changed > 0 && this.started) this.kick();
  }

  private synchronizePhysicalHistory(): void {
    const episodes = this.options.sources
      .listCompletedEpisodes()
      .slice()
      .sort((left, right) => left.completedAtMs - right.completedAtMs || left.id.localeCompare(right.id));
    for (const episode of episodes) {
      if (this.options.store.segmentForEpisode(episode.uri)) continue;
      this.enqueueTurn({ episode, sources: this.options.sources.listSources(episode.uri) });
    }
  }

  private enqueueTurn(recordedTurn: AgentMemoryRecordedTurn): void {
    this.options.store.enqueueSegmentDecision({
      episodeUri: recordedTurn.episode.uri,
      scopeKey: this.scope.key,
      sessionId: recordedTurn.episode.sessionId,
      sourceRevision: episodeRevision(recordedTurn),
      completedAtMs: recordedTurn.episode.completedAtMs,
      now: this.now().toString(),
      nowMs: this.nowMs(),
    });
  }

  private attachTurn(
    recordedTurn: AgentMemoryRecordedTurn,
    existingSegment: AgentTemporalMemoryDigest | undefined,
  ): AgentTemporalMemoryDigest {
    const episode = recordedTurn.episode;
    const completedAt = Temporal.Instant.from(episode.completedAt);
    const timeZone = this.resolveTimeZone();
    const existingForEpisode = this.options.store.segmentForEpisode(episode.uri);
    let segment = existingForEpisode ?? existingSegment;
    if (!segment) {
      const anchor = stableMemoryId("segment", [episode.sessionId, episode.uri]);
      segment = this.options.store.ensureDigest({
        scope: this.scope,
        granularity: "segment",
        digestKey: `${episode.sessionId}:${anchor}`,
        sessionId: episode.sessionId,
        periodStart: episode.startedAt,
        periodEnd: episode.completedAt,
        timeZone,
        status: "open",
        now: this.now().toString(),
      });
    }

    this.options.store.deleteAncestors(segment.uri);
    const members = this.options.store.members(segment.id).map((member) => ({
      memberUri: member.memberUri,
      memberKind: member.memberKind,
      occurredAt: member.occurredAt,
      sourceRevision: member.sourceRevision,
    }));
    const updatedMembers = [
      ...members.filter((member) => member.memberUri !== episode.uri),
      {
        memberUri: episode.uri,
        memberKind: "episode" as const,
        occurredAt: episode.completedAt,
        sourceRevision: episodeRevision(recordedTurn),
      },
    ];
    const periodStart = new Date(Math.min(segment.periodStartMs, episode.startedAtMs)).toISOString();
    const periodEnd = new Date(Math.max(segment.periodEndMs, episode.completedAtMs)).toISOString();
    const updated = this.options.store.replaceMembers(segment.id, updatedMembers, {
      periodStart,
      periodEnd,
      status: "open",
      now: this.now().toString(),
    });
    const calendarBoundary = Number(agentTemporalMemoryDayBoundary(completedAt, timeZone).epochMilliseconds);
    this.options.store.schedule(updated.id, calendarBoundary, this.now().toString());
    return updated;
  }

  private kick(): void {
    if (this.stopped || !this.options.policy().enabled) return;
    if (this.running) {
      this.drainRequested = true;
      return;
    }
    queueMicrotask(() => void this.drain().catch((error) => this.logFailure("temporal_memory.drain.failed", error)));
  }

  private drain(): Promise<void> {
    return (this.running ??= this.runDrain().finally(() => {
      this.running = undefined;
      this.scheduleNextWake();
    }));
  }

  private async runDrain(): Promise<void> {
    while (!this.stopped) {
      this.drainRequested = false;
      const policy = this.options.policy();
      this.enqueueClosedCalendarPeriods();
      let processedDecisions = 0;
      while (processedDecisions < policy.maxJobsPerDrain) {
        const decision = this.options.store.dueSegmentDecisions(this.scope.key, this.nowMs(), 1)[0];
        if (!decision) break;
        if (this.stopped) return;
        try {
          await this.processSegmentDecision(decision);
          processedDecisions += 1;
        } catch (error) {
          this.handleSegmentDecisionFailure(decision, error);
          break;
        }
      }
      const remainingCapacity = Math.max(0, policy.maxJobsPerDrain - processedDecisions);
      const jobs = this.options.store.dueJobs(this.nowMs(), remainingCapacity);
      for (const job of jobs) {
        if (this.stopped) return;
        const digest = this.options.store.digestById(job.digestId);
        if (!digest) continue;
        try {
          const prompt = projectAgentTemporalMemorySummaryInput({
            digest,
            store: this.options.store,
            sources: this.options.sources,
          });
          const summary = await this.options.summaryClient().summarize(prompt);
          const sealed = this.options.store.seal(digest.id, summary, this.now().toString());
          this.options.logger?.info("temporal_memory.digest.sealed", {
            digestUri: sealed.uri,
            granularity: sealed.granularity,
            childCount: sealed.childCount,
          });
          await this.sink?.(sealed);
          this.enqueueClosedCalendarPeriods();
        } catch (error) {
          this.handleJobFailure(digest, job.attemptCount, error);
        }
      }
      if (
        !this.drainRequested &&
        this.options.store.dueSegmentDecisions(this.scope.key, this.nowMs(), 1).length === 0 &&
        this.options.store.dueJobs(this.nowMs(), 1).length === 0
      )
        return;
    }
  }

  private async processSegmentDecision(decision: AgentConversationSegmentDecision): Promise<void> {
    const episode = this.options.sources.findEpisodesByUris([decision.episodeUri])[0];
    if (!episode) throw new Error(`Conversation segment decision references missing evidence: ${decision.episodeUri}`);
    const recordedTurn = { episode, sources: this.options.sources.listSources(episode.uri) };
    const existingAssignment = this.options.store.segmentForEpisode(episode.uri);
    if (existingAssignment) {
      this.options.store.resolveSegmentDecision({
        episodeUri: episode.uri,
        relation: "start",
        confidence: 1,
        predecessorDigestUri: null,
        assignedDigestUri: existingAssignment.uri,
        now: this.now().toString(),
      });
      return;
    }

    const openSegment = this.options.store.openSegment(this.scope.key, episode.sessionId);
    if (!openSegment) {
      const assigned = this.attachTurn(recordedTurn, undefined);
      this.options.store.resolveSegmentDecision({
        episodeUri: episode.uri,
        relation: "start",
        confidence: 1,
        predecessorDigestUri: null,
        assignedDigestUri: assigned.uri,
        now: this.now().toString(),
      });
      return;
    }

    const result = await this.options.boundaryClient().classify(
      projectAgentConversationBoundaryInput({
        segment: openSegment,
        candidate: recordedTurn,
        store: this.options.store,
        sources: this.options.sources,
        timeZone: this.resolveTimeZone(),
        anchors: this.options.boundaryAnchors?.() ?? [],
      }),
    );
    const candidateDay = agentTemporalMemoryCalendarPeriod(
      "day",
      Temporal.Instant.from(episode.completedAt),
      this.resolveTimeZone(),
    );
    const sameCalendarDay =
      openSegment.timeZone === this.resolveTimeZone() &&
      openSegment.periodStartMs >= Number(candidateDay.start.epochMilliseconds) &&
      openSegment.periodEndMs < Number(candidateDay.end.epochMilliseconds);
    const startsNewSegment = result.relation === "boundary" || !sameCalendarDay;
    if (startsNewSegment) this.options.store.schedule(openSegment.id, this.nowMs(), this.now().toString());
    const assigned = this.attachTurn(recordedTurn, startsNewSegment ? undefined : openSegment);
    this.options.store.setWorkingFocus(assigned.id, result.focus, this.now().toString());
    this.options.store.resolveSegmentDecision({
      episodeUri: episode.uri,
      relation: result.relation,
      confidence: result.confidence,
      predecessorDigestUri: startsNewSegment ? openSegment.uri : null,
      assignedDigestUri: assigned.uri,
      now: this.now().toString(),
    });
    this.options.logger?.info("temporal_memory.segment.classified", {
      episodeUri: episode.uri,
      relation: result.relation,
      confidence: result.confidence,
      segmentUri: assigned.uri,
    });
  }

  private enqueueClosedCalendarPeriods(): void {
    const now = this.now();
    const timeZone = this.resolveTimeZone();
    const currentDay = agentTemporalMemoryCalendarPeriod("day", now, timeZone);
    const closedSegments = this.options.store.list(this.scope.key, {
      granularities: ["segment"],
      statuses: ["open", "pending", "sealed", "failed", "stale"],
      endMs: Number(currentDay.start.epochMilliseconds),
    });
    for (const [dayKey, segments] of groupBy(
      closedSegments,
      (segment) => agentTemporalMemoryCalendarPeriod("day", Temporal.Instant.from(segment.periodStart), timeZone).key,
    )) {
      if (segments.some((segment) => segment.status !== "sealed")) continue;
      const period = agentTemporalMemoryCalendarPeriod(
        "day",
        Temporal.Instant.from(segments[0]!.periodStart),
        timeZone,
      );
      this.ensureCalendarDigest("day", dayKey, period.start, period.end, segments);
    }

    const currentMonth = agentTemporalMemoryCalendarPeriod("month", now, timeZone);
    const sealedDays = this.options.store.list(this.scope.key, {
      granularities: ["day"],
      statuses: ["sealed"],
      endMs: Number(currentMonth.start.epochMilliseconds),
    });
    const segmentDayKeys = new Set(
      closedSegments.map(
        (segment) => agentTemporalMemoryCalendarPeriod("day", Temporal.Instant.from(segment.periodStart), timeZone).key,
      ),
    );
    const sealedDayKeys = new Set(sealedDays.map((day) => day.digestKey));
    for (const [monthKey, days] of groupBy(
      sealedDays,
      (day) => agentTemporalMemoryCalendarPeriod("month", Temporal.Instant.from(day.periodStart), timeZone).key,
    )) {
      const monthHasPendingDay = [...segmentDayKeys].some(
        (dayKey) => dayKey.startsWith(monthKey) && !sealedDayKeys.has(dayKey),
      );
      if (monthHasPendingDay) continue;
      const period = agentTemporalMemoryCalendarPeriod("month", Temporal.Instant.from(days[0]!.periodStart), timeZone);
      this.ensureCalendarDigest("month", monthKey, period.start, period.end, days);
    }
  }

  private ensureCalendarDigest(
    granularity: "day" | "month",
    key: string,
    start: Temporal.Instant,
    end: Temporal.Instant,
    children: readonly AgentTemporalMemoryDigest[],
  ): void {
    const members = children.map((child): AgentTemporalMemoryMemberInput => ({
      memberUri: child.uri,
      memberKind: "digest",
      occurredAt: child.periodStart,
      sourceRevision: child.sourceRevision,
    }));
    const revision = memberRevision(members);
    const existing = this.options.store.digestByKey(this.scope.key, granularity, key);
    if (existing?.status === "sealed" && existing.sourceRevision === revision) return;
    const now = this.now().toString();
    const digest =
      existing ??
      this.options.store.ensureDigest({
        scope: this.scope,
        granularity,
        digestKey: key,
        periodStart: start.toString(),
        periodEnd: end.toString(),
        timeZone: this.resolveTimeZone(),
        status: "pending",
        now,
      });
    this.options.store.deleteAncestors(digest.uri);
    const updated = this.options.store.replaceMembers(digest.id, members, {
      periodStart: start.toString(),
      periodEnd: end.toString(),
      status: "pending",
      now,
    });
    this.options.store.schedule(updated.id, this.nowMs(), now);
  }

  private handleJobFailure(digest: AgentTemporalMemoryDigest, previousAttempts: number, error: unknown): void {
    const policy = this.options.policy();
    const attempt = previousAttempts + 1;
    const message = errorMessage(error);
    const now = this.now();
    if (attempt >= policy.maxAttempts) {
      this.options.store.fail(digest.id, message, now.toString());
      this.options.logger?.warn("temporal_memory.digest.failed", {
        digestUri: digest.uri,
        granularity: digest.granularity,
        attempts: attempt,
        message,
      });
      return;
    }
    const delay = Math.min(policy.retryBaseMs * 2 ** Math.max(0, attempt - 1), policy.retryMaxDelayMs);
    this.options.store.retry(digest.id, attempt, this.nowMs() + delay, message, now.toString());
    this.options.logger?.warn("temporal_memory.digest.retry_scheduled", {
      digestUri: digest.uri,
      granularity: digest.granularity,
      attempt,
      message,
    });
  }

  private handleSegmentDecisionFailure(decision: AgentConversationSegmentDecision, error: unknown): void {
    const policy = this.options.policy();
    const attempt = decision.attemptCount + 1;
    const message = errorMessage(error);
    const now = this.now();
    if (attempt >= policy.maxAttempts) {
      this.options.store.failSegmentDecision(decision.episodeUri, attempt, message, now.toString());
      this.options.logger?.warn("temporal_memory.segment.failed", {
        episodeUri: decision.episodeUri,
        attempts: attempt,
        message,
      });
      return;
    }
    const delay = Math.min(policy.retryBaseMs * 2 ** Math.max(0, attempt - 1), policy.retryMaxDelayMs);
    this.options.store.retrySegmentDecision({
      episodeUri: decision.episodeUri,
      attemptCount: attempt,
      nextAttemptAtMs: this.nowMs() + delay,
      error: message,
      now: now.toString(),
    });
    this.options.logger?.warn("temporal_memory.segment.retry_scheduled", {
      episodeUri: decision.episodeUri,
      attempt,
      message,
    });
  }

  private scheduleNextWake(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.stopped || !this.started || !this.options.policy().enabled) return;
    const nextJobAt = Math.min(
      this.options.store.nextJobAt() ?? Number.POSITIVE_INFINITY,
      this.options.store.nextSegmentDecisionAt(this.scope.key) ?? Number.POSITIVE_INFINITY,
    );
    const dayBoundary = Number(agentTemporalMemoryDayBoundary(this.now(), this.resolveTimeZone()).epochMilliseconds);
    const wakeAt = Math.min(nextJobAt, dayBoundary);
    const delay = Math.min(Math.max(0, wakeAt - this.nowMs()), MaximumTimerDelayMilliseconds);
    this.timer = setTimeout(() => this.kick(), delay);
    this.timer.unref?.();
  }

  private resolveTimeZone(): string {
    const timeZone = this.options.timeZone().trim();
    if (!timeZone) throw new Error("Temporal memory time zone must not be empty.");
    Temporal.Now.instant().toZonedDateTimeISO(timeZone);
    return timeZone;
  }

  private now(): Temporal.Instant {
    return this.options.now?.() ?? Temporal.Now.instant();
  }

  private nowMs(): number {
    return Number(this.now().epochMilliseconds);
  }

  private logFailure(event: string, error: unknown): void {
    this.options.logger?.warn(event, { message: errorMessage(error) });
  }
}

function episodeRevision(turn: AgentMemoryRecordedTurn): string {
  const hash = crypto.createHash("sha256");
  hash.update(turn.episode.uri);
  hash.update("\0");
  hash.update(turn.episode.updatedAt);
  for (const source of turn.sources) {
    hash.update(source.uri);
    hash.update("\0");
    hash.update(source.updatedAt);
    hash.update("\0");
    hash.update(source.summary ?? "");
    hash.update("\0");
    hash.update(source.textContent ?? "");
  }
  return hash.digest("hex");
}

function memberRevision(members: readonly AgentTemporalMemoryMemberInput[]): string {
  const hash = crypto.createHash("sha256");
  for (const member of members) {
    hash.update(member.memberUri);
    hash.update("\0");
    hash.update(member.sourceRevision);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): ReadonlyMap<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), value]);
  }
  return grouped;
}
