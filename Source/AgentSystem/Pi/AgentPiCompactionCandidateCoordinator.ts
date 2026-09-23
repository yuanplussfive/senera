import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import {
  AgentInferenceLaneIds,
  estimateAgentInferenceTokens,
  type AgentInferenceBudgetPort,
} from "../ModelEndpoints/AgentInferenceBudget.js";
import { AgentModelUsageLedger, type AgentModelUsage } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import {
  agentPiCompactionCandidateSnapshotDigest,
  createAgentPiCompactionCandidate,
  projectAgentPiCompactionCandidate,
  validateAgentPiCompactionCandidate,
  type AgentPiCompactionCandidate,
  type AgentPiCompactionCandidateProjection,
} from "./AgentPiCompactionCandidate.js";
import type { AgentPiCompactionCandidateStore } from "./AgentPiCompactionCandidateStore.js";
import {
  AgentPiCompactionCandidateLifecycle,
  type AgentPiCompactionCandidateRuntimeStatus,
} from "./AgentPiCompactionCandidateLifecycle.js";
import {
  mergeAgentPiCompactionIndexes,
  type AgentPiCompactionController,
  type AgentPiCompactionIndexes,
} from "./AgentPiCompactionController.js";
import { AgentPiCompactionSummaryBridgeProtocol } from "./AgentPiCompactionSummaryBridge.js";
import { AgentPiCompactionSummaryFormatterRevision } from "./AgentPiCompactionSummaryFormatter.js";
import { DefaultAgentPiCompactionProjectionPolicy } from "./AgentPiCompactionProjectionPolicy.js";
import { prepareAgentPiCompaction, type AgentPiCompactionPreparation } from "./AgentPiCompactionPreparation.js";
import { resolveAgentPiMidRunCompactionPressure } from "./AgentPiMidRunCompactionCoordinator.js";
import type { AgentPiResolvedCompactionSettings } from "./AgentPiCompactionSettings.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import { AgentPiCompactionPromptRevision } from "../PiShared/AgentPiCompactionPrompt.js";
import { projectAgentPiProviderLiveContext } from "./AgentPiTurnContextMessage.js";
import { createModelRequestLifetime } from "../ModelEndpoints/ModelHttpAbort.js";

export const AgentPiCompactionCandidateProjectionRevision = sha256HexOfCanonicalJson({
  candidateProtocol: "senera.compaction_candidate/v1",
  summaryBridge: AgentPiCompactionSummaryBridgeProtocol,
  summaryFormatter: AgentPiCompactionSummaryFormatterRevision,
  policy: DefaultAgentPiCompactionProjectionPolicy,
});

/**
 * Public, non-secret model fields that can change the semantics of the
 * summary request. Headers and credentials deliberately stay out of this
 * descriptor; only its digest is persisted with a candidate.
 */
export interface AgentPiCompactionCandidateSummaryModel {
  readonly provider: string;
  readonly api: string;
  readonly id: string;
  readonly baseUrl: string;
  readonly reasoning: boolean;
  readonly thinkingLevelMap?: Readonly<Record<string, string | null>>;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly samplingParams?: Readonly<Record<string, unknown>>;
  readonly compat?: unknown;
}

export interface AgentPiCompactionCandidateCoordinatorOptions {
  readonly frame: AgentPiMutableSessionFrame;
  readonly sessionManager: SessionManager;
  readonly provider: AgentPiProviderProjection;
  /** The actual model used by the summary compiler, not merely Pi's outer adapter. */
  readonly summaryModel?: AgentPiCompactionCandidateSummaryModel;
  readonly compactionController: AgentPiCompactionController;
  readonly store: AgentPiCompactionCandidateStore;
  readonly beforeSnapshot?: (sessionId: string) => Promise<void>;
  /** Called after an immutable candidate is durably staged and validated. */
  readonly onReady?: (candidate: AgentPiCompactionCandidate) => void;
  /** Uses the configured model request deadline without borrowing foreground cancellation. */
  readonly summaryTimeoutMs?: number;
  readonly inferenceBudget?: AgentInferenceBudgetPort;
  readonly inferenceScope?: string;
  /** Runtime-only lifecycle projection. It never changes durable Pi history. */
  readonly lifecycle?: AgentPiCompactionCandidateLifecycle;
}

export interface AgentPiCompactionCandidateSelection {
  readonly candidate: AgentPiCompactionCandidate;
  readonly projection: AgentPiCompactionCandidateProjection;
  /** Candidate prefix indexes plus indexes for the currently retained suffix. */
  readonly indexes: AgentPiCompactionIndexes;
}

interface PendingCandidateBuild {
  readonly snapshotDigest: string;
  readonly snapshotLeafId: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

interface ValidatedCandidate {
  readonly candidate: AgentPiCompactionCandidate;
  readonly validation: ReturnType<typeof validateAgentPiCompactionCandidate>;
}

interface CachedCandidateSelection {
  readonly candidateId: string;
  readonly branchLeafId: string;
  readonly routeDigest: string;
  readonly selection: AgentPiCompactionCandidateSelection;
}

/**
 * Prepares a model summary after an agent reaches a stable boundary. A ready
 * candidate is only a cache: every use revalidates its branch prefix before it
 * can replace model-facing history.
 */
export class AgentPiCompactionCandidateCoordinator {
  private pending: PendingCandidateBuild | undefined;
  private queuedSettings: AgentPiResolvedCompactionSettings | undefined;
  private disposed = false;
  private lastObservedTokens: number | undefined;
  private cachedSelection: CachedCandidateSelection | undefined;
  /**
   * Provider usage measures the projected request, not the raw Pi branch.
   * Once a candidate starts shielding an overfull branch, retain only its ID
   * so the next request cannot accidentally revert to the raw transcript.
   */
  private projectedCandidateId: string | undefined;
  private readonly lifecycle: AgentPiCompactionCandidateLifecycle;

  constructor(private readonly options: AgentPiCompactionCandidateCoordinatorOptions) {
    this.lifecycle = options.lifecycle ?? new AgentPiCompactionCandidateLifecycle();
  }

  status(): AgentPiCompactionCandidateRuntimeStatus {
    this.selectCurrentCandidate();
    return this.lifecycle.status();
  }

  schedule(settings: AgentPiResolvedCompactionSettings): void {
    if (this.disposed || !settings.enabled) return;
    const snapshot = this.options.frame.snapshot();
    if (snapshot.signal?.aborted) return;
    const sessionId = snapshot.sessionId;
    const tokenBudget = snapshot.tokenBudget;
    if (!sessionId || !tokenBudget) return;

    const occupiedTokens = tokenBudget.snapshot().occupiedTokens;
    const growthTokens = this.observeGrowth(occupiedTokens);
    const pressure = resolveAgentPiMidRunCompactionPressure(tokenBudget.snapshot(), settings);
    if (!shouldPrepareCandidate(occupiedTokens, growthTokens, pressure.triggerTokens)) return;

    const branchEntries = this.options.sessionManager.getBranch();
    const preparation = prepareAgentPiCompaction(branchEntries, settings, occupiedTokens);
    if (!preparation) return;
    const snapshotLeafId = branchEntries.at(-1)?.id;
    if (!snapshotLeafId) return;
    const snapshotIndex = branchEntries.length - 1;
    const snapshotDigest = agentPiCompactionCandidateSnapshotDigest(branchEntries, snapshotIndex);
    if (this.pending?.snapshotDigest === snapshotDigest) return;

    const routeDigest = this.modelRouteDigest();
    const existing = this.findValidCandidate({
      sessionId,
      branchEntries,
      modelRouteDigest: routeDigest,
    });
    if (existing && this.canServePreparation(existing.candidate, preparation, branchEntries)) {
      this.lifecycle.adoptReady(existing.candidate);
      return;
    }
    if (this.pending) {
      // Keep the immutable in-flight snapshot alive, but remember that the
      // active branch moved forward. Once the old job settles, the latest
      // branch is evaluated again instead of being silently skipped.
      this.queuedSettings = settings;
      return;
    }

    // Candidates use the same transcript projection as formal compaction.
    // Historical host overlays are audit evidence only and must not consume a
    // background summary request or reappear in a new checkpoint.
    const summarizedMessages = projectAgentPiProviderLiveContext(
      [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages],
      undefined,
    );
    const indexes = this.options.compactionController.createIndexes(branchEntries, summarizedMessages);
    const source = {
      sessionId,
      snapshot,
      branchEntries: [...branchEntries],
      snapshotLeafId,
      preparation,
      summarizedMessages,
      indexes,
      routeDigest,
    };
    const controller = new AbortController();
    this.lifecycle.beginPreparation(snapshotLeafId);
    const promise = this.build(source, controller.signal)
      .catch((error) => this.reportUnexpectedBuildFailure(source, controller.signal, error))
      .finally(() => {
        if (this.pending?.promise !== promise) return;
        this.pending = undefined;
        const queuedSettings = this.queuedSettings;
        this.queuedSettings = undefined;
        if (queuedSettings && !this.disposed) queueMicrotask(() => this.schedule(queuedSettings));
      });
    this.pending = { snapshotDigest, snapshotLeafId, controller, promise };
  }

  projectCurrentContext(messages: readonly AgentMessage[]): AgentPiCompactionCandidateSelection | undefined {
    const selection = this.selectCurrentCandidate();
    if (!selection) {
      this.projectedCandidateId = undefined;
      return undefined;
    }
    // A candidate projection is derived entirely from the active branch. If a
    // future Pi release adds request-local context before this hook, preserve
    // the original message list until we can prove the projection is lossless.
    if (messages.length > 0 && selection.projection.messages.length === 0) return undefined;
    return selection;
  }

  /**
   * Checks the same turn-safe cut before triggering Pi's formal idle
   * compaction. A ready but too-shallow candidate must be rebuilt rather than
   * accidentally causing a synchronous summary on the idle path.
   */
  selectForIdleCompaction(
    settings: AgentPiResolvedCompactionSettings,
  ): AgentPiCompactionCandidateSelection | undefined {
    const branchEntries = this.options.sessionManager.getBranch();
    const preparation = prepareAgentPiCompaction(branchEntries, settings);
    return preparation ? this.selectForFormalCompaction(preparation, branchEntries) : undefined;
  }

  /**
   * The normal context hook keeps raw Pi history until the latest complete
   * provider measurement has entered the configured pressure band. This keeps
   * the normal prompt-cache prefix stable while a checkpoint waits in reserve.
   */
  projectProviderContext(
    messages: readonly AgentMessage[],
    settings: AgentPiResolvedCompactionSettings,
  ): AgentPiCompactionCandidateSelection | undefined {
    if (!settings.enabled) {
      this.projectedCandidateId = undefined;
      return undefined;
    }
    const selection = this.projectCurrentContext(messages);
    if (!selection) return undefined;
    if (this.projectedCandidateId === selection.candidate.id) return selection;
    this.projectedCandidateId = undefined;
    const tokenBudget = this.options.frame.snapshot().tokenBudget;
    if (!tokenBudget) return undefined;
    const pressure = resolveAgentPiMidRunCompactionPressure(tokenBudget.snapshot(), settings);
    if (tokenBudget.snapshot().occupiedTokens < pressure.triggerTokens) return undefined;
    this.projectedCandidateId = selection.candidate.id;
    return selection;
  }

  /**
   * Returns a ready candidate only when its retained boundary is at least as
   * compact as Pi's current safe cut. This prevents a stale candidate from
   * keeping more history than the impending hard-pressure compaction can fit.
   */
  selectForFormalCompaction(
    preparation: Pick<AgentPiCompactionPreparation, "firstKeptEntryId">,
    branchEntries: readonly SessionEntry[],
  ): AgentPiCompactionCandidateSelection | undefined {
    const sessionId = this.options.frame.snapshot().sessionId;
    if (!sessionId || this.disposed) return undefined;
    const candidate = this.findValidCandidate({
      sessionId,
      branchEntries,
      modelRouteDigest: this.modelRouteDigest(),
    });
    if (!candidate) return undefined;
    if (!this.canServePreparation(candidate.candidate, preparation, branchEntries)) return undefined;
    const selection = this.createSelection(candidate, branchEntries, this.modelRouteDigest());
    if (selection) this.lifecycle.adoptReady(selection.candidate);
    return selection;
  }

  beginFormalApplication(candidate: AgentPiCompactionCandidate): void {
    this.lifecycle.beginApplication(candidate);
  }

  /** A formal Pi compaction has atomically materialized the checkpoint. */
  completeFormalCompaction(candidateId: string | undefined): void {
    this.clearCachedSelection();
    this.clearProjectedCandidate();
    const sessionId = this.options.frame.snapshot().sessionId;
    if (sessionId) this.options.store.removeSession(sessionId);
    if (candidateId) this.lifecycle.completeApplication(candidateId);
    else this.lifecycle.invalidate();
  }

  /** A cancellation keeps the immutable candidate available for a later safe boundary. */
  restoreFormalApplication(candidateId: string): void {
    const candidate = this.selectCurrentCandidate();
    if (candidate?.candidate.id === candidateId) this.lifecycle.restoreReady(candidate.candidate);
    else this.lifecycle.invalidateCandidate(candidateId);
  }

  /** An application error discards the candidate so a later attempt is rebuilt from fresh state. */
  failFormalApplication(candidateId: string): boolean {
    if (!this.lifecycle.failApplication(candidateId)) return false;
    this.clearCachedSelection(candidateId);
    this.clearProjectedCandidate(candidateId);
    this.options.store.remove(candidateId);
    return true;
  }

  restoreUncommittedApplication(candidateId: string): void {
    this.restoreFormalApplication(candidateId);
  }

  /** Cancel only in-flight work; a completed, separately validated candidate remains reusable. */
  abortPending(reason: unknown = new Error("Pi compaction candidate was superseded.")): void {
    this.queuedSettings = undefined;
    if (this.pending) this.lifecycle.cancelPreparation(this.pending.snapshotLeafId);
    this.pending?.controller.abort(reason);
  }

  invalidateSession(): void {
    this.queuedSettings = undefined;
    this.cachedSelection = undefined;
    this.projectedCandidateId = undefined;
    const sessionId = this.options.frame.snapshot().sessionId;
    if (sessionId) this.options.store.removeSession(sessionId);
    this.lifecycle.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.queuedSettings = undefined;
    this.cachedSelection = undefined;
    this.projectedCandidateId = undefined;
    this.abortPending(new Error("Pi compaction candidate coordinator was disposed."));
    this.lifecycle.invalidate();
  }

  private observeGrowth(occupiedTokens: number): number {
    const previous = this.lastObservedTokens;
    this.lastObservedTokens = occupiedTokens;
    return previous === undefined ? 0 : Math.max(0, occupiedTokens - previous);
  }

  private selectCurrentCandidate(): AgentPiCompactionCandidateSelection | undefined {
    if (this.disposed) return undefined;
    const snapshot = this.options.frame.snapshot();
    const sessionId = snapshot.sessionId;
    if (!sessionId) return undefined;
    const branchEntries = this.options.sessionManager.getBranch();
    const routeDigest = this.modelRouteDigest();
    const candidate = this.findValidCandidate({ sessionId, branchEntries, modelRouteDigest: routeDigest });
    if (!candidate) {
      this.lifecycle.clearStaleReady();
      return undefined;
    }
    this.lifecycle.adoptReady(candidate.candidate);
    return this.createSelection(candidate, branchEntries, routeDigest);
  }

  private findValidCandidate(input: {
    readonly sessionId: string;
    readonly branchEntries: readonly SessionEntry[];
    readonly modelRouteDigest: string;
  }): ValidatedCandidate | undefined {
    for (const candidate of this.options.store.list(input.sessionId)) {
      const validation = validateAgentPiCompactionCandidate(candidate, {
        sessionId: input.sessionId,
        branchEntries: input.branchEntries,
        modelRouteDigest: input.modelRouteDigest,
        promptRevision: AgentPiCompactionPromptRevision,
        projectionRevision: AgentPiCompactionCandidateProjectionRevision,
      });
      if (validation.valid) return { candidate, validation };
      this.clearCachedSelection(candidate.id);
      this.clearProjectedCandidate(candidate.id);
      this.lifecycle.invalidateCandidate(candidate.id);
      this.options.store.remove(candidate.id);
    }
    return undefined;
  }

  private createSelection(
    candidate: ValidatedCandidate,
    branchEntries: readonly SessionEntry[],
    routeDigest: string,
  ): AgentPiCompactionCandidateSelection | undefined {
    const branchLeafId = branchEntries.at(-1)?.id;
    if (!branchLeafId) return undefined;
    const cached = this.cachedSelection;
    if (
      cached?.candidateId === candidate.candidate.id &&
      cached.branchLeafId === branchLeafId &&
      cached.routeDigest === routeDigest
    ) {
      return cached.selection;
    }
    const projection = projectAgentPiCompactionCandidate(candidate.candidate, branchEntries, candidate.validation);
    if (!projection) return undefined;
    const suffixIndexes = this.options.compactionController.createSuffixIndexes(projection.messages.slice(1));
    const selection = {
      candidate: candidate.candidate,
      projection,
      indexes: mergeAgentPiCompactionIndexes([candidate.candidate.indexes, suffixIndexes]),
    } satisfies AgentPiCompactionCandidateSelection;
    this.cachedSelection = {
      candidateId: candidate.candidate.id,
      branchLeafId,
      routeDigest,
      selection,
    };
    return selection;
  }

  private clearCachedSelection(candidateId?: string): void {
    if (!candidateId || this.cachedSelection?.candidateId === candidateId) this.cachedSelection = undefined;
  }

  private clearProjectedCandidate(candidateId?: string): void {
    if (!candidateId || this.projectedCandidateId === candidateId) this.projectedCandidateId = undefined;
  }

  private modelRouteDigest(): string {
    return createAgentPiCompactionCandidateRouteDigest(this.options.provider, this.options.summaryModel);
  }

  /**
   * A candidate remains reusable while its kept suffix is no larger than the
   * safe cut selected for the current branch. Appending a new turn therefore
   * does not automatically trigger another summary call; only lost headroom
   * does.
   */
  private canServePreparation(
    candidate: AgentPiCompactionCandidate,
    preparation: Pick<AgentPiCompactionPreparation, "firstKeptEntryId">,
    branchEntries: readonly SessionEntry[],
  ): boolean {
    const candidateBoundary = branchEntries.findIndex((entry) => entry.id === candidate.firstKeptEntryId);
    const requestedBoundary = branchEntries.findIndex((entry) => entry.id === preparation.firstKeptEntryId);
    return candidateBoundary >= requestedBoundary && requestedBoundary >= 0;
  }

  private async build(
    source: {
      readonly sessionId: string;
      readonly snapshot: ReturnType<AgentPiMutableSessionFrame["snapshot"]>;
      readonly branchEntries: readonly SessionEntry[];
      readonly snapshotLeafId: string;
      readonly preparation: AgentPiCompactionPreparation;
      readonly summarizedMessages: readonly AgentMessage[];
      readonly indexes: AgentPiCompactionIndexes;
      readonly routeDigest: string;
    },
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      this.lifecycle.cancelPreparation(source.snapshotLeafId);
      return;
    }
    const summaryInput = {
      mode: "compact" as const,
      messages: source.summarizedMessages,
      previousSummary: source.preparation.previousSummary,
      artifactIndex: source.indexes.artifactIndex,
      toolCallIndex: source.indexes.toolCallIndex,
      continuityLedger: source.indexes.continuityLedger,
    };
    let reservationId: string | undefined;
    const budget = this.options.inferenceBudget;
    if (budget && this.options.inferenceScope) {
      const decision = budget.reserve({
        scope: this.options.inferenceScope,
        lane: AgentInferenceLaneIds.Compaction,
        sourceId: "pi.compaction.candidate",
        requestId: source.snapshotLeafId,
        estimatedInputTokens: estimateAgentInferenceTokens(summaryInput),
      });
      if (!decision.allowed || !decision.reservation) {
        this.lifecycle.deferPreparation(source.snapshotLeafId);
        await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.candidate.deferred", {
          reason: decision.reason,
          retryAtMs: decision.retryAtMs,
          snapshotLeafId: source.snapshotLeafId,
        });
        return;
      }
      reservationId = decision.reservation.id;
    }

    let summary: string | undefined;
    let candidateUsage: AgentModelUsage | undefined;
    const summaryLifetime = createModelRequestLifetime({ MaxRequestMs: this.options.summaryTimeoutMs ?? -1 }, signal);
    try {
      await this.options.beforeSnapshot?.(source.sessionId);
      if (signal.aborted) {
        this.lifecycle.cancelPreparation(source.snapshotLeafId);
        return;
      }
      await this.options.compactionController.emitDiagnosticSnapshot(source.snapshot, "compaction.candidate.started", {
        snapshotLeafId: source.snapshotLeafId,
        firstKeptEntryId: source.preparation.firstKeptEntryId,
        summarizedMessages: summaryInput.messages.length,
      });
      const usageLedger = new AgentModelUsageLedger();
      const compiledSummary = await this.options.compactionController.compileSummarySnapshot(
        source.snapshot,
        summaryInput,
        summaryLifetime.signal,
        {
          usageSink: (call) => usageLedger.record(call),
        },
      );
      summary = compiledSummary;
      candidateUsage = usageLedger.aggregate();
      if (candidateUsage) {
        await this.options.compactionController.emitDiagnosticSnapshot(source.snapshot, "compaction.candidate.usage", {
          snapshotLeafId: source.snapshotLeafId,
          usage: candidateUsage,
        });
      }
      if (signal.aborted) {
        this.lifecycle.cancelPreparation(source.snapshotLeafId);
        return;
      }
      const candidate = createAgentPiCompactionCandidate({
        id: createOpaqueId("pi-compaction-candidate"),
        sessionId: source.sessionId,
        branchEntries: source.branchEntries,
        snapshotLeafId: source.snapshotLeafId,
        firstKeptEntryId: source.preparation.firstKeptEntryId,
        tokensBefore: source.preparation.tokensBefore,
        summary: compiledSummary,
        indexes: source.indexes,
        modelRouteDigest: source.routeDigest,
        promptRevision: AgentPiCompactionPromptRevision,
        projectionRevision: AgentPiCompactionCandidateProjectionRevision,
      });
      const validation = validateAgentPiCompactionCandidate(candidate, {
        sessionId: source.sessionId,
        branchEntries: this.options.sessionManager.getBranch(),
        modelRouteDigest: source.routeDigest,
        promptRevision: AgentPiCompactionPromptRevision,
        projectionRevision: AgentPiCompactionCandidateProjectionRevision,
      });
      if (!validation.valid) {
        this.lifecycle.deferPreparation(source.snapshotLeafId);
        await this.options.compactionController.emitDiagnosticSnapshot(
          source.snapshot,
          "compaction.candidate.discarded",
          {
            candidateId: candidate.id,
            reason: validation.reason,
          },
        );
        return;
      }
      this.clearCachedSelection();
      this.options.store.replace(candidate);
      this.lifecycle.markReady(candidate);
      await this.options.compactionController.emitDiagnosticSnapshot(source.snapshot, "compaction.candidate.ready", {
        candidateId: candidate.id,
        snapshotLeafId: candidate.snapshotLeafId,
        firstKeptEntryId: candidate.firstKeptEntryId,
      });
      this.options.onReady?.(candidate);
    } catch (error) {
      if (signal.aborted) {
        this.lifecycle.cancelPreparation(source.snapshotLeafId);
      } else {
        this.lifecycle.failPreparation(source.snapshotLeafId);
        await this.options.compactionController.emitDiagnosticSnapshot(source.snapshot, "compaction.candidate.failed", {
          snapshotLeafId: source.snapshotLeafId,
          message: errorMessage(error),
        });
      }
    } finally {
      summaryLifetime.dispose();
      if (reservationId) {
        budget?.settle({
          reservationId,
          ...(candidateUsage?.inputTokens === undefined ? {} : { actualInputTokens: candidateUsage.inputTokens }),
          ...(candidateUsage?.outputTokens === undefined
            ? summary
              ? { actualOutputTokens: estimateAgentInferenceTokens(summary) }
              : {}
            : { actualOutputTokens: candidateUsage.outputTokens }),
        });
      }
    }
  }

  private async reportUnexpectedBuildFailure(
    source: { readonly snapshot: ReturnType<AgentPiMutableSessionFrame["snapshot"]>; readonly snapshotLeafId: string },
    signal: AbortSignal,
    error: unknown,
  ): Promise<void> {
    if (signal.aborted) {
      this.lifecycle.cancelPreparation(source.snapshotLeafId);
      return;
    }
    this.lifecycle.failPreparation(source.snapshotLeafId);
    await this.options.compactionController.emitDiagnosticSnapshot(source.snapshot, "compaction.candidate.failed", {
      snapshotLeafId: source.snapshotLeafId,
      message: errorMessage(error),
    });
  }
}

function shouldPrepareCandidate(occupiedTokens: number, growthTokens: number, triggerTokens: number): boolean {
  if (occupiedTokens >= triggerTokens) return true;
  return growthTokens > 0 && occupiedTokens + growthTokens >= triggerTokens;
}

export function createAgentPiCompactionCandidateRouteDigest(
  provider: AgentPiProviderProjection,
  summaryModel: AgentPiCompactionCandidateSummaryModel = provider.model,
): string {
  return sha256HexOfCanonicalJson({
    runtime: {
      providerId: provider.providerId,
      toolPlanningMode: provider.toolPlanningMode,
      model: projectCandidateModel(provider.model),
    },
    summary: projectCandidateModel(summaryModel),
  });
}

function projectCandidateModel(model: AgentPiCompactionCandidateSummaryModel): AgentPiCompactionCandidateSummaryModel {
  return {
    provider: model.provider,
    api: model.api,
    id: model.id,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.samplingParams ? { samplingParams: { ...model.samplingParams } } : {}),
    ...(model.compat === undefined ? {} : { compat: model.compat }),
  };
}
