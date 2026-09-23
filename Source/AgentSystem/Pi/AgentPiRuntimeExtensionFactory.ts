import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  prepareBranchEntries,
  type AgentSession,
  type ExtensionFactory,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { applyAgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import { readAgentPiArtifactIndex, type AgentPiArtifactIndex } from "./AgentPiArtifactIndex.js";
import {
  createAgentPiCompactionToolCallIndex,
  readAgentPiCompactionToolCallIndex,
  type AgentPiCompactionToolCallIndex,
} from "./AgentPiCompactionToolIndex.js";
import {
  AgentPiCompactionSummaryBridge,
  type AgentPiCompactionSummaryBridgeOptions,
} from "./AgentPiCompactionSummaryBridge.js";
import { DefaultAgentPiCompactionSummaryFormatterOptions } from "./AgentPiCompactionSummaryFormatter.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import {
  projectAgentPiLiveContextMessage,
  projectAgentPiProviderLiveContext,
  stripAgentPiContextOverlayMessages,
} from "./AgentPiTurnContextMessage.js";
import { projectAgentPiToolResultStatus } from "./AgentPiToolResultPolicy.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { AgentPiTerminalToolObservationProjector } from "./AgentPiTerminalToolObservation.js";
import { AgentPiCompactionController, type AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import { AgentPiMidRunCompactionCoordinator } from "./AgentPiMidRunCompactionCoordinator.js";
import type { AgentPiResolvedCompactionSettings } from "./AgentPiCompactionSettings.js";
import { projectAgentPiContextForPressure } from "./AgentPiContextPressureProjection.js";
import { readAgentPiContinuityLedger } from "./AgentPiContinuityLedger.js";
import type { AgentContinuityLedger } from "../Continuity/AgentContinuityLedger.js";
import { renderAgentPiSkillLibraryPrompt } from "./AgentPiSkillLibraryPrompt.js";
import {
  AgentPiCompactionSummarySources,
  createAgentPiDeterministicCompactionSummary,
  type AgentPiCompactionSummarySource,
} from "./AgentPiCompactionRecovery.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentInferenceBudgetPort } from "../ModelEndpoints/AgentInferenceBudget.js";
import { projectAgentNativeToolModel } from "../ModelEndpoints/AgentNativeToolModelProjector.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiCompactionCandidateCoordinator } from "./AgentPiCompactionCandidateCoordinator.js";
import {
  AgentPiCompactionCandidateMemoryStore,
  type AgentPiCompactionCandidateStore,
} from "./AgentPiCompactionCandidateStore.js";
import { canApplyAgentPiCompactionCandidate } from "./AgentPiCompactionSafety.js";
import type { AgentPiCompactionCandidateRuntimeStatus } from "./AgentPiCompactionCandidateLifecycle.js";

export interface AgentPiRuntimeExtensionFactoryOptions {
  readonly provider: AgentPiProviderProjection;
  /** Source route for BAML compaction calls, which can differ from Pi's adapter model. */
  readonly modelProvider: ResolvedAgentModelProviderConfig;
  readonly planningCompilerFactory: AgentPiPlanningCompilerFactory;
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly beforeCompaction?: (sessionId: string) => Promise<void>;
  readonly compactionCandidateStore?: AgentPiCompactionCandidateStore;
  readonly inferenceBudget?: AgentInferenceBudgetPort;
  readonly inferenceScope?: () => string | undefined;
}

export interface AgentPiRuntimeExtensionRegistration {
  readonly name: string;
  readonly hidden: true;
  readonly factory: ExtensionFactory;
  install(session: AgentSession, settings: AgentPiResolvedCompactionSettings): void;
  /** Identifier-free lifecycle state for the session runtime status DTO. */
  compactionCandidateStatus(): AgentPiCompactionCandidateRuntimeStatus;
}

export class AgentPiRuntimeExtensionFactory {
  private readonly compactionCandidateStore: AgentPiCompactionCandidateStore;

  constructor(private readonly options: AgentPiRuntimeExtensionFactoryOptions) {
    this.compactionCandidateStore = options.compactionCandidateStore ?? new AgentPiCompactionCandidateMemoryStore();
  }

  create(frame: AgentPiMutableSessionFrame, sessionManager: SessionManager): AgentPiRuntimeExtensionRegistration {
    let pendingCompactionIndex: AgentPiArtifactIndex | undefined;
    let pendingCompactionToolIndex: AgentPiCompactionToolCallIndex | undefined;
    let pendingCompactionLedger: AgentContinuityLedger | undefined;
    let pendingCompactionCandidateId: string | undefined;
    let autoCompactionFailureKey: string | undefined;
    const clearPendingCompaction = () => {
      pendingCompactionIndex = undefined;
      pendingCompactionToolIndex = undefined;
      pendingCompactionLedger = undefined;
      pendingCompactionCandidateId = undefined;
    };
    const stagePendingCompaction = (indexes: AgentPiCompactionIndexes, candidateId?: string) => {
      pendingCompactionIndex = indexes.artifactIndex;
      pendingCompactionToolIndex = indexes.toolCallIndex;
      pendingCompactionLedger = indexes.continuityLedger;
      pendingCompactionCandidateId = candidateId;
    };
    const takePendingCompaction = () => {
      const pending = {
        artifactIndex: pendingCompactionIndex,
        toolCallIndex: pendingCompactionToolIndex,
        continuityLedger: pendingCompactionLedger,
        candidateId: pendingCompactionCandidateId,
      };
      clearPendingCompaction();
      return pending;
    };
    const reportedInvalidArtifactIndexes = new Set<string>();
    const reportedInvalidToolIndexes = new Set<string>();
    const compactionSummaryBridge = new AgentPiCompactionSummaryBridge({
      formatterOptions: {
        ...DefaultAgentPiCompactionSummaryFormatterOptions,
        model: this.options.provider.model.id,
      },
    } satisfies AgentPiCompactionSummaryBridgeOptions);
    const terminalToolObservations = new AgentPiTerminalToolObservationProjector(this.options.provider.model.id);
    const compactionController = new AgentPiCompactionController({
      planningCompilerFactory: this.options.planningCompilerFactory,
      diagnostics: this.options.diagnostics,
      continuityScope: () => frame.snapshot().sessionId ?? frame.snapshot().logicalCacheScope,
    });
    let activeCompactionSettings: AgentPiResolvedCompactionSettings | undefined;
    let installedSession: AgentSession | undefined;
    let disposeCompactionOutcome: (() => void) | undefined;
    let compactionApplyInFlight = false;
    let observedCandidateApplicationId: string | undefined;
    let activeCandidateApplicationId: string | undefined;
    const applyReadyCompactionAtIdle = async (): Promise<void> => {
      const session = installedSession;
      if (
        !session ||
        !activeCompactionSettings ||
        compactionApplyInFlight ||
        !canApplyAgentPiCompactionCandidate({
          isIdle: session.isIdle,
          isCompacting: session.isCompacting,
          pendingMessageCount: session.pendingMessageCount,
        })
      ) {
        return;
      }
      // Validate against the same safe cut Pi will use before starting a
      // formal compaction. This keeps the idle path model-free: a stale
      // candidate is left in reserve rather than falling through to a
      // synchronous summary request.
      const candidate = compactionCandidates.selectForIdleCompaction(activeCompactionSettings);
      if (!candidate) return;

      compactionApplyInFlight = true;
      observedCandidateApplicationId = undefined;
      try {
        // Materialize the derived result through Pi's normal compaction path.
        // The session_before_compact hook still validates the branch and stages
        // Senera's Artifact/Tool-call indexes before the append-only commit.
        await session.compact();
      } catch (error) {
        // Pi emits compaction_end before compact() rejects. The subscription
        // below has already restored or discarded a candidate in that normal
        // path, so avoid reporting a cancellation or failure twice.
        if (observedCandidateApplicationId === candidate.candidate.id) return;
        const unresolvedCandidateId = activeCandidateApplicationId;
        activeCandidateApplicationId = undefined;
        if (unresolvedCandidateId) compactionCandidates.failFormalApplication(unresolvedCandidateId);
        await compactionController.emitDiagnostic(frame, "compaction.candidate.apply_failed", {
          candidateId: unresolvedCandidateId ?? candidate.candidate.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        compactionApplyInFlight = false;
      }
    };
    const compactionCandidates = new AgentPiCompactionCandidateCoordinator({
      frame,
      sessionManager,
      provider: this.options.provider,
      summaryModel: projectAgentNativeToolModel(this.options.modelProvider),
      compactionController,
      store: this.compactionCandidateStore,
      beforeSnapshot: this.options.beforeCompaction,
      summaryTimeoutMs: this.options.modelProvider.MaxRequestMs,
      inferenceBudget: this.options.inferenceBudget,
      inferenceScope: this.options.inferenceScope?.(),
      onReady: () => {
        void applyReadyCompactionAtIdle();
      },
    });
    let cachedLiveContextFrameRevision = -1;
    let cachedLiveContext: ReturnType<typeof projectAgentPiLiveContextMessage>;
    const currentLiveContext = () => {
      const frameRevision = frame.revision();
      if (frameRevision === cachedLiveContextFrameRevision) return cachedLiveContext;
      const snapshot = frame.snapshot();
      cachedLiveContext = projectAgentPiLiveContextMessage({
        liveContext: snapshot.liveContext,
        skills: frame.skillSnapshot(),
        selectedPromptTemplates: snapshot.selectedPromptTemplates,
      });
      cachedLiveContextFrameRevision = frameRevision;
      return cachedLiveContext;
    };
    const normalizeSessionMessageState = () => {
      const session = installedSession;
      if (!session) return;
      const current = session.agent.state.messages;
      const normalized = stripAgentPiContextOverlayMessages(current);
      if (normalized.length !== current.length) session.agent.state.messages = normalized;
    };
    const projectProviderMessages = async (
      messages: readonly AgentMessage[],
      compactionIndexes?: AgentPiCompactionIndexes,
    ): Promise<AgentMessage[]> => {
      const snapshot = frame.snapshot();
      const indexes = compactionIndexes ?? (await readPersistedCompactionIndexes());
      const bridgeResult = compactionSummaryBridge.transform({
        // Old append-only turn snapshots must never reach a provider or a
        // compaction summary. They are migration-only session evidence now.
        messages: projectAgentPiProviderLiveContext(messages, undefined),
        toolCallIndex: indexes.toolCallIndex,
      });
      const pressureProjection =
        activeCompactionSettings?.enabled && snapshot.tokenBudget
          ? projectAgentPiContextForPressure(bridgeResult.messages, {
              model: this.options.provider.model.id,
              contextWindowTokens: snapshot.tokenBudget.contextWindowTokens,
              outputReserveTokens: snapshot.tokenBudget.outputReserveTokens,
              keepRecentTokens: activeCompactionSettings.keepRecentTokens,
              observedProviderTokens: snapshot.tokenBudget.snapshot().occupiedTokens,
            })
          : undefined;
      if (pressureProjection?.projectedMessages) {
        await compactionController.emitDiagnostic(frame, "context.pressure_projection", {
          projectedMessages: pressureProjection.projectedMessages,
          tokensBefore: pressureProjection.tokensBefore,
          tokensAfter: pressureProjection.tokensAfter,
          reclaimedTokens: pressureProjection.reclaimedTokens,
          triggerTokens: pressureProjection.triggerTokens,
          observedProviderTokens: pressureProjection.observedProviderTokens,
        });
      }
      const projectedMessages = pressureProjection?.messages ?? bridgeResult.messages;
      const contextPolicyMessages = snapshot.tokenBudget
        ? applyAgentPiContextPolicy(
            projectedMessages,
            snapshot.contextPolicy,
            indexes.artifactIndex.artifacts,
            snapshot.tokenBudget,
          )
        : projectedMessages;
      // The overlay is intentionally injected after all transcript-oriented
      // projections. It therefore cannot shift the current-turn boundary for
      // pressure handling, and it is never persisted by Pi.
      return projectAgentPiProviderLiveContext(contextPolicyMessages, currentLiveContext());
    };
    const readPersistedCompactionIndexes = async (): Promise<AgentPiCompactionIndexes> => {
      const contextEntries = sessionManager.buildContextEntries();
      const artifactIndex = readAgentPiArtifactIndex(contextEntries);
      if (artifactIndex.invalidEntryId && !reportedInvalidArtifactIndexes.has(artifactIndex.invalidEntryId)) {
        reportedInvalidArtifactIndexes.add(artifactIndex.invalidEntryId);
        await compactionController.emitDiagnostic(frame, "artifact-index.invalid", {
          entryId: artifactIndex.invalidEntryId,
        });
      }
      const toolIndexResult = readAgentPiCompactionToolCallIndex(contextEntries);
      if (toolIndexResult.invalidEntryId && !reportedInvalidToolIndexes.has(toolIndexResult.invalidEntryId)) {
        reportedInvalidToolIndexes.add(toolIndexResult.invalidEntryId);
        await compactionController.emitDiagnostic(frame, "compaction-tool-index.invalid", {
          entryId: toolIndexResult.invalidEntryId,
        });
      }
      return {
        artifactIndex: { artifacts: artifactIndex.artifacts },
        toolCallIndex: toolIndexResult.index ?? createAgentPiCompactionToolCallIndex([]),
        continuityLedger: readAgentPiContinuityLedger(contextEntries),
      };
    };
    const midRunCompaction = new AgentPiMidRunCompactionCoordinator({
      frame,
      sessionManager,
      compactionController,
      projectProviderMessages,
      compactionCandidates,
    });
    let installed = false;
    return {
      name: "senera-runtime",
      hidden: true,
      factory: (pi) => {
        pi.on("before_agent_start", (event) => {
          // A foreground request does not invalidate an immutable checkpoint.
          // It may finish while this request is active and will be applied at
          // the next idle boundary, preserving the work already paid for.
          const snapshot = frame.snapshot();
          return {
            systemPrompt: [
              snapshot.systemPrompt ?? "",
              event.systemPrompt,
              renderAgentPiSkillLibraryPrompt(snapshot.skillLibraryCatalog),
            ]
              .filter((value) => value.trim().length > 0)
              .join("\n\n"),
          };
        });
        pi.on("tool_call", (event) =>
          frame.snapshot().preflight({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          }),
        );
        pi.on("tool_result", (event) => projectAgentPiToolResultStatus(event.details));
        pi.on("tool_execution_end", (event) => {
          terminalToolObservations.settle(frame.snapshot().turnState, event);
        });
        pi.on("message_end", (event) => {
          const replacement = terminalToolObservations.replaceMessage(event.message);
          return replacement ? { message: replacement } : undefined;
        });
        pi.on("session_before_compact", async (event) => {
          compactionCandidates.abortPending(new Error("Formal Pi compaction superseded candidate preparation."));
          // `session_compact` fires only after Pi has appended the returned
          // summary. Never let a cancelled or failed earlier attempt leave
          // indexes staged for a later, unrelated event.
          clearPendingCompaction();
          await this.flushBeforeCompaction(frame.snapshot().sessionId);
          const summarizedMessages = projectAgentPiProviderLiveContext(
            [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages],
            undefined,
          );
          const customInstructions = event.customInstructions?.trim();
          const candidate = customInstructions
            ? undefined
            : compactionCandidates.selectForFormalCompaction(event.preparation, event.branchEntries);
          const failureKey = `${event.reason}:${event.preparation.firstKeptEntryId}`;
          if (candidate) {
            autoCompactionFailureKey = undefined;
            compactionCandidates.beginFormalApplication(candidate.candidate);
            activeCandidateApplicationId = candidate.candidate.id;
            stagePendingCompaction(candidate.indexes, candidate.candidate.id);
            await compactionController.emitDiagnostic(frame, "compaction.candidate.committed", {
              candidateId: candidate.candidate.id,
              reason: event.reason,
              firstKeptEntryId: candidate.candidate.firstKeptEntryId,
              requestedFirstKeptEntryId: event.preparation.firstKeptEntryId,
            });
            return {
              compaction: {
                summary: candidate.candidate.summary,
                firstKeptEntryId: candidate.candidate.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
                details: {
                  artifactIndex: pendingCompactionIndex,
                  toolCallIndex: pendingCompactionToolIndex,
                  summarySource: AgentPiCompactionSummarySources.model,
                },
              },
            };
          }
          if (event.reason !== "manual" && autoCompactionFailureKey === failureKey) {
            await compactionController.emitDiagnostic(frame, "compaction.auto.retry_suppressed", {
              reason: event.reason,
              firstKeptEntryId: event.preparation.firstKeptEntryId,
            });
            return { cancel: true };
          }
          const indexes = compactionController.createIndexes(event.branchEntries, summarizedMessages);
          const summaryInput = {
            mode: "compact" as const,
            messages: summarizedMessages,
            previousSummary: event.preparation.previousSummary,
            customInstructions: event.customInstructions,
            fileOperations: event.preparation.fileOps,
            artifactIndex: indexes.artifactIndex,
            toolCallIndex: indexes.toolCallIndex,
            continuityLedger: indexes.continuityLedger,
          };
          let summary: string;
          let summarySource: AgentPiCompactionSummarySource = AgentPiCompactionSummarySources.model;
          try {
            summary = await compactionController.compileSummary(frame, summaryInput, event.signal);
            autoCompactionFailureKey = undefined;
          } catch (error) {
            if (event.reason === "manual") throw error;
            throwIfAborted(event.signal);
            try {
              summary = createAgentPiDeterministicCompactionSummary(summaryInput, {
                model: this.options.provider.model.id,
                reason: event.reason,
              });
              summarySource = AgentPiCompactionSummarySources.deterministicRecovery;
              autoCompactionFailureKey = undefined;
              await compactionController.emitDiagnostic(frame, "compaction.auto.recovered", {
                reason: event.reason,
                message: error instanceof Error ? error.message : String(error),
                summarizedMessages: summarizedMessages.length,
                firstKeptEntryId: event.preparation.firstKeptEntryId,
              });
            } catch (recoveryError) {
              autoCompactionFailureKey = failureKey;
              await compactionController.emitDiagnostic(frame, "compaction.auto.recovery_failed", {
                reason: event.reason,
                message: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
                firstKeptEntryId: event.preparation.firstKeptEntryId,
              });
              throw recoveryError;
            }
          }
          stagePendingCompaction(indexes);
          return {
            compaction: {
              summary,
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
              details: {
                artifactIndex: pendingCompactionIndex,
                toolCallIndex: pendingCompactionToolIndex,
                summarySource,
              },
            },
          };
        });
        pi.on("session_compact", () => {
          autoCompactionFailureKey = undefined;
          midRunCompaction.resetHysteresis();
          normalizeSessionMessageState();
          const pending = takePendingCompaction();
          if (pending.artifactIndex || pending.toolCallIndex || pending.continuityLedger) {
            compactionController.appendIndexes(sessionManager, {
              artifactIndex: pending.artifactIndex ?? { artifacts: [] },
              toolCallIndex: pending.toolCallIndex ?? createAgentPiCompactionToolCallIndex([]),
              ...(pending.continuityLedger ? { continuityLedger: pending.continuityLedger } : {}),
            });
          }
          // Any formal compaction creates a new branch epoch. The coordinator
          // removes all derived candidates only after Pi has atomically
          // appended the checkpoint and indexes above have been persisted.
          compactionCandidates.completeFormalCompaction(pending.candidateId);
          if (pending.candidateId) activeCandidateApplicationId = undefined;
        });
        pi.on("context", async (event) => {
          const candidate = activeCompactionSettings
            ? compactionCandidates.projectProviderContext(event.messages, activeCompactionSettings)
            : undefined;
          if (!candidate) return { messages: await projectProviderMessages(event.messages) };
          await compactionController.emitDiagnostic(frame, "compaction.candidate.projected", {
            candidateId: candidate.candidate.id,
            firstKeptEntryId: candidate.candidate.firstKeptEntryId,
          });
          return {
            messages: await projectProviderMessages(candidate.projection.messages, candidate.indexes),
          };
        });
        pi.on("session_before_tree", async (event) => {
          // Tree summarization is foreground work on the same model lane.
          // Its new branch makes any in-flight checkpoint obsolete before the
          // tree operation finishes, so yield immediately.
          compactionCandidates.abortPending(new Error("Pi tree operation superseded candidate preparation."));
          await this.flushBeforeCompaction(frame.snapshot().sessionId);
          const prepared = prepareBranchEntries(
            event.preparation.entriesToSummarize,
            this.options.provider.model.contextWindow - this.options.provider.model.maxTokens,
          );
          const messages = projectAgentPiProviderLiveContext(prepared.messages, undefined);
          const indexes = compactionController.createIndexes(event.preparation.entriesToSummarize, messages);
          const summary = await compactionController.compileSummary(
            frame,
            {
              mode: "tree",
              messages,
              customInstructions: event.preparation.customInstructions,
              fileOperations: prepared.fileOps,
              artifactIndex: indexes.artifactIndex,
              toolCallIndex: indexes.toolCallIndex,
              continuityLedger: indexes.continuityLedger,
            },
            event.signal,
          );
          return {
            summary: {
              summary,
              details: indexes,
            },
          };
        });
        pi.on("session_tree", () => {
          autoCompactionFailureKey = undefined;
          compactionCandidates.invalidateSession();
          midRunCompaction.resetHysteresis();
          normalizeSessionMessageState();
        });
        pi.on("turn_end", () => {
          // Start preparing while a long agent run still has work to do. The
          // immutable snapshot is validated again before it can affect Pi;
          // only agent_settled is allowed to materialize a ready candidate.
          if (!activeCompactionSettings) return;
          compactionCandidates.schedule(activeCompactionSettings);
        });
        pi.on("agent_settled", () => {
          if (!activeCompactionSettings) return;
          compactionCandidates.schedule(activeCompactionSettings);
          void applyReadyCompactionAtIdle();
        });
        pi.on("model_select", () => {
          compactionCandidates.abortPending(new Error("Model selection changed the compaction route."));
          compactionCandidates.invalidateSession();
        });
        pi.on("thinking_level_select", () => {
          compactionCandidates.abortPending(new Error("Thinking level changed the compaction route."));
          compactionCandidates.invalidateSession();
        });
        pi.on("session_shutdown", () => {
          disposeCompactionOutcome?.();
          disposeCompactionOutcome = undefined;
          compactionCandidates.dispose();
        });
      },
      install: (session, settings) => {
        if (installed) return;
        installed = true;
        installedSession = session;
        disposeCompactionOutcome = session.subscribe((event) => {
          if (event.type !== "compaction_end" || event.result !== undefined) return;
          const pending = takePendingCompaction();
          const candidateId = activeCandidateApplicationId ?? pending.candidateId;
          if (!candidateId) return;
          activeCandidateApplicationId = undefined;
          observedCandidateApplicationId = candidateId;
          if (event.aborted) {
            compactionCandidates.restoreFormalApplication(candidateId);
            return;
          }
          if (!event.errorMessage) {
            compactionCandidates.restoreUncommittedApplication(candidateId);
            return;
          }
          if (!compactionCandidates.failFormalApplication(candidateId)) return;
          void compactionController
            .emitDiagnostic(frame, "compaction.candidate.apply_failed", {
              candidateId,
              reason: event.reason,
              message: event.errorMessage,
            })
            .catch(() => undefined);
        });
        normalizeSessionMessageState();
        activeCompactionSettings = settings;
        const previous = session.agent.prepareNextTurnWithContext;
        session.agent.prepareNextTurnWithContext = async (turn, signal) => {
          const refreshed = await previous?.(turn, signal);
          const context = refreshed?.context ?? turn.context;
          const compacted = await midRunCompaction.prepareNextTurn({ ...turn, context }, session, settings, signal);
          return compacted ? { ...refreshed, context: compacted } : refreshed;
        };
      },
      compactionCandidateStatus: () => compactionCandidates.status(),
    };
  }

  private async flushBeforeCompaction(sessionId: string | undefined): Promise<void> {
    if (!this.options.beforeCompaction) return;
    if (!sessionId) throw new Error("Pi compaction requires a continuity session identity.");
    await this.options.beforeCompaction(sessionId);
  }
}
