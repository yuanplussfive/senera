import { resolveContinuityLearningConfig } from "../AgentDefaults.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentEventKinds, emitAgentEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import type {
  AgentMemoryDeletionImpact,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";
import type { ResolvedAgentContinuityLearningConfig, AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentContinuityCandidateCompiler } from "./AgentContinuityCandidateCompiler.js";
import { AgentContinuityLearningModelClient } from "./AgentContinuityLearningModelClient.js";
import { countAgentContinuityModels } from "./AgentContinuityLearningSchema.js";
import {
  buildAgentContinuityFactPromptInput,
  buildAgentContinuityRulePromptInput,
} from "./AgentContinuityLearningPromptProjector.js";
import type { AgentContinuityRulesSnapshot } from "./AgentContinuityMemoryTypes.js";
import { collectAgentContinuityModelingContext } from "./AgentContinuityRuleContext.js";
import { AgentContinuitySqliteStore, type AgentContinuityLearningJob } from "./AgentContinuitySqliteStore.js";
import type { AgentContinuityLearningClaim } from "./AgentContinuitySqliteTypes.js";
import { AgentContinuitySemanticRecall } from "./AgentContinuitySemanticRecall.js";
import type { AgentResidentProfileService } from "../Profile/AgentResidentProfileService.js";
import type { AgentContinuityLearningEnqueueOptions } from "../Memory/AgentMemoryService.js";
import { listAgentContinuityPromptScopes } from "./AgentContinuityScopes.js";
import { buildAgentContinuityLearningReferentContext } from "./AgentContinuityLearningReferentContext.js";
import { projectAgentContinuityPhysicalSemanticDocuments } from "./AgentContinuitySemanticDocument.js";
import type { AgentAgendaLearningBridge } from "../Agenda/AgentAgendaLearningBridge.js";
import type { AgentAgendaSnapshot } from "../Agenda/AgentAgendaTypes.js";
import { requireAgentContinuityIdentity, type AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import { AgentContinuityLearningInferenceRuntime } from "./AgentContinuityLearningInferenceRuntime.js";
import { selectAgentContinuityLearningCatalogs } from "./AgentContinuityLearningContextSelector.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import { AgentInferenceBudgetExceededError } from "../ModelEndpoints/AgentInferenceBudget.js";
import { recordActiveAgentModelUsage } from "../ModelEndpoints/AgentModelUsage.js";

export interface AgentContinuityLearningModel {
  extractFacts: AgentContinuityLearningModelClient["extractFacts"];
  extractRules: AgentContinuityLearningModelClient["extractRules"];
}

export interface AgentContinuityLearningRuntimeOptions {
  readonly sourceRepository: AgentMemorySourceRepository;
  readonly store: AgentContinuitySqliteStore;
  readonly identity: AgentContinuityIdentityContext;
  readonly configSnapshot: () => AgentSystemConfig;
  readonly logger?: AgentLogger;
  readonly residentProfile: AgentResidentProfileService;
  readonly agendaLearning: AgentAgendaLearningBridge;
  readonly agendaTimeZone: () => string;
  readonly rulesSnapshot: (input: { sessionId: string; now: Date }) => AgentContinuityRulesSnapshot;
  readonly modelClientFactory?: (configuration: ResolvedAgentContinuityLearningConfig) => AgentContinuityLearningModel;
  /** Optional write-time embedding of learned summaries; failures never fail learning. */
  readonly semanticRecall?: AgentContinuitySemanticRecall;
  readonly now?: () => number;
  readonly runtimePolicy: () => AgentContinuityLearningRuntimePolicy;
  /** Optional shared token/request budget for background model calls. */
  readonly inferenceBudget?: AgentInferenceBudgetPort;
}

export interface AgentContinuityLearningRuntimePolicy {
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxDelayMs: number;
  readonly maxJobsPerDrain: number;
}

/** Learns immutable facts first, then condition state and rules only when requested. */
export class AgentContinuityLearningRuntime {
  private readonly inferenceRuntime: AgentContinuityLearningInferenceRuntime;
  private readonly recordedTurns = new Map<string, AgentMemoryRecordedTurn>();
  private readonly activeClaims = new Map<string, AgentContinuityActiveLearningClaim>();
  private embeddingTail: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private drainPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private started = false;
  private stopping = false;
  private stopped = false;
  private eventSink?: AgentEventSink;

  constructor(private readonly options: AgentContinuityLearningRuntimeOptions) {
    this.inferenceRuntime = new AgentContinuityLearningInferenceRuntime({
      store: options.store,
      identity: options.identity,
      logger: options.logger,
      inferenceBudget: options.inferenceBudget,
    });
  }

  setEventSink(eventSink: AgentEventSink | undefined): void {
    this.eventSink = eventSink;
  }

  start(): void {
    if (this.started || this.stopping || this.stopped) return;
    this.options.store.recoverInterruptedLearningJobs(this.now());
    this.consolidateCrossEpisodeFacts("startup");
    this.started = true;
    this.requestDrain();
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.stopPromise = (async () => {
      await this.drainPromise;
      await this.flushEmbeddings();
      this.stopped = true;
      this.eventSink = undefined;
      this.recordedTurns.clear();
    })();
    return this.stopPromise;
  }

  /** Releases deferred fact jobs before a host operation compacts context. */
  async flush(): Promise<void> {
    if (!this.started || this.stopped) return;
    this.options.store.releasePendingLearningJobs(this.now());
    while (true) {
      await this.drainDue();
      const next = this.options.store.nextLearningDueAtMs();
      if (next === undefined || next > this.now()) return;
    }
  }

  enqueue(recordedTurn: AgentMemoryRecordedTurn, options: AgentContinuityLearningEnqueueOptions = {}): void {
    if (this.stopping || this.stopped) throw new Error("Continuity learning runtime is closing.");
    const now = this.now();
    this.recordedTurns.set(recordedTurn.episode.uri, recordedTurn);
    const nextAttemptAtMs = Math.max(now, options.nextAttemptAtMs ?? now);
    this.options.store.enqueueLearning(recordedTurn.episode.uri, nextAttemptAtMs);
    if (options.nextAttemptAtMs !== undefined) {
      this.options.store.deferPendingFactJobsForSession(recordedTurn.episode.sessionId, now, nextAttemptAtMs);
    }
    this.scheduleNextDrain();
  }

  indexPhysicalTurn(recordedTurn: AgentMemoryRecordedTurn): void {
    const configuration = resolveContinuityLearningConfig(this.options.configSnapshot());
    if (!this.options.semanticRecall || !configuration.Recall.Semantic.Enabled) return;
    this.queueSemanticDocuments(projectAgentContinuityPhysicalSemanticDocuments(recordedTurn.sources));
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    const deleted = new Set(impact.sourceUris);
    for (const [episodeUri, recordedTurn] of this.recordedTurns) {
      if (recordedTurn.sources.some((source) => deleted.has(source.uri))) this.recordedTurns.delete(episodeUri);
    }
    for (const episodeUri of impact.episodeUris) this.cancelActiveClaim(episodeUri, "episode_deleted");
  }

  deleteSession(sessionId: string): void {
    for (const [episodeUri, recordedTurn] of this.recordedTurns) {
      if (recordedTurn.episode.sessionId === sessionId) this.recordedTurns.delete(episodeUri);
    }
    for (const [episodeUri, active] of this.activeClaims) {
      if (active.sessionId === sessionId) this.cancelActiveClaim(episodeUri, "session_deleted");
    }
  }

  private async drainDue(): Promise<void> {
    if (!this.started || this.stopped) return;
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.runDueJobs().finally(() => {
      this.drainPromise = undefined;
      this.scheduleNextDrain();
    });
    return this.drainPromise;
  }

  private async runDueJobs(): Promise<void> {
    const { maxJobsPerDrain } = this.options.runtimePolicy();
    let processed = 0;
    for (const job of this.options.store.listDueLearningJobs(this.now(), maxJobsPerDrain)) {
      if (this.stopped) return;
      await this.runJob(job);
      processed += 1;
    }
    if (processed > 0) this.consolidateCrossEpisodeFacts("learning_drain");
  }

  /** Folds equivalent fact heads discovered by separate episodes in one deterministic sweep. */
  private consolidateCrossEpisodeFacts(trigger: "startup" | "learning_drain"): void {
    const result = this.options.store.reconcileAllFacts(new Date(this.now()));
    if (result.supersededFacts > 0) {
      this.options.logger?.info("continuity.learning.cross_episode_consolidated", {
        trigger,
        scopes: result.scopes,
        supersededFacts: result.supersededFacts,
      });
    }
  }

  private async runJob(dueJob: AgentContinuityLearningJob): Promise<void> {
    const now = this.now();
    const job = this.options.store.claimLearningJob(dueJob.episodeUri, dueJob.stage, now);
    if (!job) return;
    const claim = learningClaim(job);
    const recordedTurn = this.recordedTurns.get(job.episodeUri) ?? this.hydrateRecordedTurn(job.episodeUri);
    if (!recordedTurn) {
      this.failJob(claim, "continuity episode is missing", true);
      return;
    }
    const controller = new AbortController();
    const active: AgentContinuityActiveLearningClaim = {
      sessionId: recordedTurn.episode.sessionId,
      controller,
    };
    this.activeClaims.set(job.episodeUri, active);

    try {
      const needsRulePass =
        job.stage === "facts" ? await this.learnFacts(recordedTurn, claim, controller.signal) : false;
      if (job.stage === "rules") await this.learnRules(recordedTurn, job.facts, claim, controller.signal);
      if (job.stage === "rules" || !needsRulePass) this.recordedTurns.delete(job.episodeUri);
    } catch (error) {
      if (controller.signal.aborted || error instanceof AgentContinuityLearningClaimSupersededError) {
        this.options.logger?.info("continuity.learning.cancelled", {
          requestId: recordedTurn.episode.requestId,
          episodeUri: job.episodeUri,
          stage: job.stage,
          attempt: job.attempts,
          reason: controller.signal.aborted ? cancellationReason(controller.signal) : "claim_superseded",
        });
        return;
      }
      const terminal = job.attempts >= this.options.runtimePolicy().maxAttempts;
      const budgetDeferred = error instanceof AgentInferenceBudgetExceededError;
      const transitioned = this.failJob(
        claim,
        errorMessage(error),
        budgetDeferred ? false : terminal,
        recordedTurn.episode.requestId,
        budgetDeferred ? error.retryAtMs : undefined,
      );
      if (!transitioned) {
        this.options.logger?.info("continuity.learning.cancelled", {
          requestId: recordedTurn.episode.requestId,
          episodeUri: job.episodeUri,
          stage: job.stage,
          attempt: job.attempts,
          reason: "claim_superseded",
        });
      }
      if (terminal && !budgetDeferred) this.recordedTurns.delete(job.episodeUri);
      return;
    } finally {
      if (this.activeClaims.get(job.episodeUri) === active) this.activeClaims.delete(job.episodeUri);
    }
  }

  private async learnFacts(
    recordedTurn: AgentMemoryRecordedTurn,
    claim: AgentContinuityLearningClaim,
    signal: AbortSignal,
  ): Promise<boolean> {
    const configuration = resolveContinuityLearningConfig(this.options.configSnapshot());
    const nowMs = this.now();
    const now = new Date(nowMs);
    const residentProfile = this.options.residentProfile.promptContext(
      listAgentContinuityPromptScopes(this.options.identity, recordedTurn.episode.sessionId),
      now,
    );
    const referents = this.referentsFor(recordedTurn, configuration.LearningContext.ReferentBudgetCharacters);
    const timeZone = this.options.agendaTimeZone();
    const agendaSnapshot = this.options.agendaLearning.snapshot(timeZone, now);
    const catalogs = selectAgentContinuityLearningCatalogs({
      recordedTurn,
      referents,
      profiles: residentProfile,
      agendaRecords: agendaSnapshot.records,
      budgetCharacters: configuration.LearningContext.CatalogBudgetCharacters,
      similarity: configuration.Recall.Ranking.Similarity,
    });
    const promptInput = buildAgentContinuityFactPromptInput(recordedTurn, catalogs.profiles, referents, {
      ...agendaSnapshot,
      records: catalogs.agendaRecords,
    });
    const inference = configuration.Enabled
      ? await this.inferenceRuntime.extractFacts({
          promptInput,
          configuration,
          signal,
          nowMs,
          invoke: (input, options) => this.modelClient(configuration).extractFacts(input, options),
        })
      : undefined;
    const extracted = inference?.output ?? { items: [], agenda: [], needsRulePass: false };
    throwIfLearningCancelled(signal);
    const existingFactHeads = this.options.store.listFactHeads(
      [
        { kind: "user", id: requireAgentContinuityIdentity(this.options.identity, "user") },
        { kind: "session", id: recordedTurn.episode.sessionId },
      ],
      now,
    );
    const batch = new AgentContinuityCandidateCompiler({
      identity: this.options.identity,
      recordedTurn,
      observedAt: new Date(nowMs).toISOString(),
      existingFactHeads,
      factIdentityFuzzyScore: configuration.Recall.Ranking.FactIdentityFuzzyScore,
      recallPolicy: configuration.Recall.Ranking,
    }).compileFacts(extracted);
    const agenda = this.options.agendaLearning.apply({
      drafts: extracted.agenda,
      recordedTurn,
      timeZone,
      now,
      ranking: configuration.Recall.Ranking,
    });
    if (inference) {
      this.inferenceRuntime.record(
        inference,
        recordedTurn.episode.uri,
        batch.observations.length + batch.profiles.length + batch.relations.length + agenda.recordedCount,
        nowMs,
      );
    }
    this.options.residentProfile.recordMany(batch.profiles, new Date(nowMs).toISOString());
    const transition = this.options.store.completeFactLearning(
      claim,
      {
        observations: batch.observations,
        facts: batch.facts,
        relations: batch.relations,
        needsRulePass: extracted.needsRulePass,
      },
      nowMs,
    );
    if (transition === "superseded") throw new AgentContinuityLearningClaimSupersededError(claim);
    if (configuration.Recall.Semantic.Enabled) {
      this.queueSemanticDocuments(
        batch.observations.map((observation) => ({ uri: observation.uri, text: observation.summary })),
      );
    }
    this.recordTurnValueTrainingExample(
      configuration,
      recordedTurn,
      batch.observations.length + batch.profiles.length + batch.relations.length + agenda.recordedCount,
      extracted.needsRulePass,
    );
    this.options.logger?.info("continuity.learning.facts_recorded", {
      requestId: recordedTurn.episode.requestId,
      episodeUri: recordedTurn.episode.uri,
      facts: batch.facts.length,
      agenda: agenda.recordedCount,
      agendaCreated: agenda.accepted.filter(({ disposition }) => disposition === "created").length,
      agendaEvolved: agenda.accepted.filter(({ disposition }) => disposition === "evolved").length,
      agendaIdempotent: agenda.accepted.filter(({ disposition }) => disposition === "idempotent").length,
      agendaRejected: agenda.rejected.length,
      needsRulePass: extracted.needsRulePass,
    });
    for (const rejection of agenda.rejected) {
      this.options.logger?.warn("continuity.learning.agenda_rejected", {
        requestId: recordedTurn.episode.requestId,
        episodeUri: recordedTurn.episode.uri,
        kind: rejection.draft.kind,
        change: rejection.draft.change,
        summary: rejection.draft.summary,
        reason: rejection.reason,
      });
    }
    if (agenda.recordedCount > 0) await this.publishAgendaSnapshot(recordedTurn, agenda.snapshot);
    return extracted.needsRulePass;
  }

  /** Records only completed extraction outcomes as classifier training evidence. */
  private recordTurnValueTrainingExample(
    configuration: ResolvedAgentContinuityLearningConfig,
    recordedTurn: AgentMemoryRecordedTurn,
    capturedCount: number,
    needsRulePass: boolean,
  ): void {
    const gate = configuration.Recall.TurnValueClassifier;
    const userText = recordedTurn.episode.rawUserText.trim();
    if (!userText) return;
    const label = capturedCount > 0 || needsRulePass ? "valuable" : "unproductive";
    this.options.store.recordTurnValueTrainingExample(userText, label, new Date(this.now()).toISOString());
    this.options.store.pruneTurnValueTrainingExamples(gate.MaxTrainingEntries);
  }

  /**
   * Queues write-time embedding on a detached serial chain. The learning
   * drain never waits for embeddings: a slow or failing endpoint must not
   * occupy a job slot, and a missing vector simply degrades semantic recall
   * to lexical ranking on the read path. The chain serializes embedding
   * requests so one slow endpoint never receives concurrent batches.
   */
  private queueSemanticDocuments(documents: readonly { readonly uri: string; readonly text: string }[]): void {
    if (!this.options.semanticRecall || documents.length === 0) return;
    this.embeddingTail = this.embeddingTail
      .then(() => this.options.semanticRecall!.embedDocuments(documents))
      .then(() => undefined)
      .catch((error) => {
        this.options.logger?.warn("continuity.semantic.embed_queued_failed", { message: errorMessage(error) });
      });
  }

  /** Waits for in-flight write-time embeddings; used by shutdown and tests. */
  async flushEmbeddings(): Promise<void> {
    await this.embeddingTail;
    await this.options.semanticRecall?.flush();
  }

  private async learnRules(
    recordedTurn: AgentMemoryRecordedTurn,
    facts: readonly string[],
    claim: AgentContinuityLearningClaim,
    signal: AbortSignal,
  ): Promise<void> {
    const configuration = resolveContinuityLearningConfig(this.options.configSnapshot());
    if (!configuration.Enabled) {
      throw new Error("Continuity modeling was requested after continuity learning was disabled.");
    }
    const modelingContext = collectAgentContinuityModelingContext({
      store: this.options.store,
      identity: this.options.identity,
      sessionId: recordedTurn.episode.sessionId,
      now: new Date(this.now()),
    });
    const referents = this.referentsFor(recordedTurn, configuration.LearningContext.ReferentBudgetCharacters);
    const promptInput = buildAgentContinuityRulePromptInput(recordedTurn, facts, modelingContext, referents);
    const inference = await this.inferenceRuntime.extractRules({
      promptInput,
      configuration,
      signal,
      nowMs: this.now(),
      invoke: (input, options) => this.modelClient(configuration).extractRules(input, options),
    });
    const extracted = inference.output;
    throwIfLearningCancelled(signal);
    const nowMs = this.now();
    const batch = new AgentContinuityCandidateCompiler({
      identity: this.options.identity,
      recordedTurn,
      observedAt: new Date(nowMs).toISOString(),
      recallPolicy: configuration.Recall.Ranking,
    }).compileRules(extracted, modelingContext);
    this.inferenceRuntime.record(inference, recordedTurn.episode.uri, batch.signals.length + batch.rules.length, nowMs);
    const transition = this.options.store.completeRuleLearning(claim, batch, nowMs);
    if (transition === "superseded") throw new AgentContinuityLearningClaimSupersededError(claim);
    this.options.logger?.info("continuity.learning.models_recorded", {
      requestId: recordedTurn.episode.requestId,
      episodeUri: recordedTurn.episode.uri,
      models: countAgentContinuityModels(extracted),
      stateSignals: batch.signals.length,
      rules: batch.rules.length,
    });
    await this.publishRulesSnapshot(recordedTurn);
  }

  private failJob(
    claim: AgentContinuityLearningClaim,
    message: string,
    terminal: boolean,
    requestId?: string,
    retryAtMs?: number,
  ): boolean {
    const current = this.now();
    const transition = this.options.store.failLearningJob(claim, {
      terminal,
      nextAttemptAtMs: terminal ? current : (retryAtMs ?? current + this.retryDelay(claim.attempt)),
      lastError: message,
      nowMs: current,
    });
    if (transition === "superseded") return false;
    this.options.logger?.warn(terminal ? "continuity.learning.failed" : "continuity.learning.retry_scheduled", {
      requestId,
      episodeUri: claim.episodeUri,
      stage: claim.stage,
      attempt: claim.attempt,
      message,
    });
    return true;
  }

  private modelClient(configuration: ResolvedAgentContinuityLearningConfig): AgentContinuityLearningModel {
    return (
      this.options.modelClientFactory?.(configuration) ??
      new AgentContinuityLearningModelClient({
        configuration,
        usageSink: ({ stage, usage }) => {
          recordActiveAgentModelUsage({ stage, usage });
          this.options.logger?.info("continuity.learning.model_usage", {
            stage,
            providerId: configuration.Client.ModelProvider.Id,
            model: configuration.Client.ModelProvider.Model,
            ...usage,
          });
        },
      })
    );
  }

  private referentsFor(recordedTurn: AgentMemoryRecordedTurn, budgetCharacters: number) {
    return buildAgentContinuityLearningReferentContext({
      sourceRepository: this.options.sourceRepository,
      recordedTurn,
      budgetCharacters,
    }).entries;
  }

  private async publishRulesSnapshot(recordedTurn: AgentMemoryRecordedTurn): Promise<void> {
    try {
      await emitAgentEvent(this.eventSink, {
        kind: AgentEventKinds.ContinuityRulesSnapshot,
        context: {
          sessionId: recordedTurn.episode.sessionId,
          requestId: recordedTurn.episode.requestId,
        },
        data: this.options.rulesSnapshot({
          sessionId: recordedTurn.episode.sessionId,
          now: new Date(this.now()),
        }),
      });
    } catch (error) {
      this.options.logger?.warn("continuity.rules_snapshot.publish_failed", {
        requestId: recordedTurn.episode.requestId,
        episodeUri: recordedTurn.episode.uri,
        message: errorMessage(error),
      });
    }
  }

  private async publishAgendaSnapshot(
    recordedTurn: AgentMemoryRecordedTurn,
    snapshot: AgentAgendaSnapshot,
  ): Promise<void> {
    try {
      await emitAgentEvent(this.eventSink, {
        kind: AgentEventKinds.AgendaSnapshot,
        context: {
          sessionId: recordedTurn.episode.sessionId,
          requestId: recordedTurn.episode.requestId,
        },
        data: { snapshot },
      });
    } catch (error) {
      this.options.logger?.warn("agenda.snapshot.publish_failed", {
        requestId: recordedTurn.episode.requestId,
        episodeUri: recordedTurn.episode.uri,
        message: errorMessage(error),
      });
    }
  }

  private hydrateRecordedTurn(episodeUri: string): AgentMemoryRecordedTurn | undefined {
    const episode = this.options.sourceRepository.findEpisodesByUris([episodeUri])[0];
    return episode ? { episode, sources: this.options.sourceRepository.listSources(episodeUri) } : undefined;
  }

  private scheduleNextDrain(): void {
    if (!this.started || this.stopping || this.stopped || this.drainPromise) return;
    const next = this.options.store.nextLearningDueAtMs();
    if (next === undefined) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.requestDrain();
      },
      Math.max(0, next - this.now()),
    );
    this.timer.unref();
  }

  private requestDrain(): void {
    void this.drainDue().catch((error) => {
      this.options.logger?.error("continuity.learning.drain_failed", { message: errorMessage(error) });
    });
  }

  private cancelActiveClaim(episodeUri: string, reason: AgentContinuityLearningCancellationReason): void {
    const active = this.activeClaims.get(episodeUri);
    if (!active || active.controller.signal.aborted) return;
    active.controller.abort(new AgentContinuityLearningCancellationError(reason));
  }

  private retryDelay(attempt: number): number {
    const policy = this.options.runtimePolicy();
    return Math.min(policy.retryMaxDelayMs, policy.retryBaseMs * 2 ** Math.max(0, attempt - 1));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

type AgentContinuityLearningCancellationReason = "episode_deleted" | "session_deleted";

interface AgentContinuityActiveLearningClaim {
  readonly sessionId: string;
  readonly controller: AbortController;
}

class AgentContinuityLearningCancellationError extends Error {
  constructor(readonly reason: AgentContinuityLearningCancellationReason) {
    super(`Continuity learning cancelled: ${reason}.`);
    this.name = "AgentContinuityLearningCancellationError";
  }
}

class AgentContinuityLearningClaimSupersededError extends Error {
  constructor(readonly claim: AgentContinuityLearningClaim) {
    super(`Continuity learning claim was superseded: ${claim.episodeUri} ${claim.stage} attempt ${claim.attempt}.`);
    this.name = "AgentContinuityLearningClaimSupersededError";
  }
}

function learningClaim(job: AgentContinuityLearningJob): AgentContinuityLearningClaim {
  return { episodeUri: job.episodeUri, stage: job.stage, attempt: job.attempts };
}

function throwIfLearningCancelled(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function cancellationReason(signal: AbortSignal): string {
  return signal.reason instanceof AgentContinuityLearningCancellationError ? signal.reason.reason : "request_cancelled";
}
