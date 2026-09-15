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
import { projectAgentPiTurnContextMessage } from "./AgentPiTurnContextMessage.js";
import { projectAgentPiToolResultStatus } from "./AgentPiToolResultPolicy.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { AgentPiTerminalToolObservationProjector } from "./AgentPiTerminalToolObservation.js";
import { AgentPiCompactionController, type AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import { AgentPiMidRunCompactionCoordinator } from "./AgentPiMidRunCompactionCoordinator.js";
import type { AgentPiResolvedCompactionSettings } from "./AgentPiCompactionSettings.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";
import { emptyAgentPiPromptDisclosureState, type AgentPiPromptDisclosureState } from "./AgentPiPromptDisclosure.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { projectAgentPiContextForPressure } from "./AgentPiContextPressureProjection.js";
import { readAgentPiContinuityLedger } from "./AgentPiContinuityLedger.js";
import type { AgentContinuityLedger } from "../Continuity/AgentContinuityLedger.js";
import { renderAgentPiSkillLibraryPrompt } from "./AgentPiSkillLibraryPrompt.js";

export interface AgentPiRuntimeExtensionFactoryOptions {
  readonly provider: AgentPiProviderProjection;
  readonly planningCompilerFactory: AgentPiPlanningCompilerFactory;
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly beforeCompaction?: (sessionId: string) => Promise<void>;
}

export interface AgentPiRuntimeExtensionRegistration {
  readonly name: string;
  readonly hidden: true;
  readonly factory: ExtensionFactory;
  install(session: AgentSession, settings: AgentPiResolvedCompactionSettings): void;
}

export class AgentPiRuntimeExtensionFactory {
  constructor(private readonly options: AgentPiRuntimeExtensionFactoryOptions) {}

  create(frame: AgentPiMutableSessionFrame, sessionManager: SessionManager): AgentPiRuntimeExtensionRegistration {
    let pendingCompactionIndex: AgentPiArtifactIndex | undefined;
    let pendingCompactionToolIndex: AgentPiCompactionToolCallIndex | undefined;
    let pendingCompactionLedger: AgentContinuityLedger | undefined;
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
    let persistedPromptDisclosureRevision = sha256HexOfCanonicalJson(frame.promptDisclosureState());
    const persistPromptDisclosure = (state: AgentPiPromptDisclosureState): void => {
      const revision = sha256HexOfCanonicalJson(state);
      if (revision === persistedPromptDisclosureRevision) return;
      try {
        sessionManager.appendCustomEntry(AgentPiSessionCustomEntryTypes.PromptDisclosure, state);
        persistedPromptDisclosureRevision = revision;
      } catch (error) {
        void compactionController.emitDiagnostic(frame, "prompt.disclosure.persistence_failed", {
          revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const projectProviderMessages = async (
      messages: readonly AgentMessage[],
      compactionIndexes?: AgentPiCompactionIndexes,
    ): Promise<AgentMessage[]> => {
      const snapshot = frame.snapshot();
      const indexes = compactionIndexes ?? (await readPersistedCompactionIndexes());
      const bridgeResult = compactionSummaryBridge.transform({
        messages,
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
      return snapshot.tokenBudget
        ? applyAgentPiContextPolicy(
            projectedMessages,
            snapshot.contextPolicy,
            indexes.artifactIndex.artifacts,
            snapshot.tokenBudget,
          )
        : projectedMessages;
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
    });
    let installed = false;
    return {
      name: "senera-runtime",
      hidden: true,
      factory: (pi) => {
        pi.on("before_agent_start", (event) => {
          const snapshot = frame.snapshot();
          const disclosure = frame.promptDisclosurePlan();
          const message = projectAgentPiTurnContextMessage({
            turnContext: snapshot.turnContext,
            skills: frame.skillSnapshot(),
            selectedPromptTemplates: snapshot.selectedPromptTemplates,
            disclosure,
          });
          frame.commitPromptDisclosure(disclosure);
          persistPromptDisclosure(frame.promptDisclosureState());
          void compactionController.emitDiagnostic(frame, "prompt.disclosure", {
            newSkills: disclosure.newSkills.length,
            reusedSkills: disclosure.reusedSkills.length,
            newPromptTemplates: disclosure.newPromptTemplates.length,
            reusedPromptTemplates: disclosure.reusedPromptTemplates.length,
            disclosedSkillCount: frame.promptDisclosureState().skillKeys.length,
            disclosedPromptTemplateCount: frame.promptDisclosureState().promptTemplateKeys.length,
          });
          return {
            systemPrompt: [
              snapshot.systemPrompt ?? "",
              event.systemPrompt,
              renderAgentPiSkillLibraryPrompt(snapshot.skillLibraryCatalog),
            ]
              .filter((value) => value.trim().length > 0)
              .join("\n\n"),
            ...(message ? { message } : {}),
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
          // The compaction projection may remove the earlier full resource
          // blocks. Re-disclose active resources on the first turn after the
          // compacted transcript is installed.
          frame.resetPromptDisclosure();
          await this.flushBeforeCompaction(frame.snapshot().sessionId);
          const summarizedMessages = [
            ...event.preparation.messagesToSummarize,
            ...event.preparation.turnPrefixMessages,
          ];
          const indexes = compactionController.createIndexes(event.branchEntries, summarizedMessages);
          pendingCompactionIndex = indexes.artifactIndex;
          pendingCompactionToolIndex = indexes.toolCallIndex;
          pendingCompactionLedger = indexes.continuityLedger;
          const summary = await compactionController.compileSummary(
            frame,
            {
              mode: "compact",
              messages: summarizedMessages,
              previousSummary: event.preparation.previousSummary,
              customInstructions: event.customInstructions,
              fileOperations: event.preparation.fileOps,
              artifactIndex: pendingCompactionIndex,
              toolCallIndex: pendingCompactionToolIndex,
              continuityLedger: indexes.continuityLedger,
            },
            event.signal,
          );
          return {
            compaction: {
              summary,
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
              details: {
                artifactIndex: pendingCompactionIndex,
                toolCallIndex: pendingCompactionToolIndex,
              },
            },
          };
        });
        pi.on("session_compact", () => {
          midRunCompaction.resetHysteresis();
          frame.resetPromptDisclosure();
          persistPromptDisclosure(emptyAgentPiPromptDisclosureState());
          const index = pendingCompactionIndex;
          pendingCompactionIndex = undefined;
          const toolIndex = pendingCompactionToolIndex;
          pendingCompactionToolIndex = undefined;
          const ledger = pendingCompactionLedger;
          pendingCompactionLedger = undefined;
          if (index || toolIndex || ledger) {
            compactionController.appendIndexes(sessionManager, {
              artifactIndex: index ?? { artifacts: [] },
              toolCallIndex: toolIndex ?? createAgentPiCompactionToolCallIndex([]),
              ...(ledger ? { continuityLedger: ledger } : {}),
            });
          }
        });
        pi.on("context", async (event) => {
          return { messages: await projectProviderMessages(event.messages) };
        });
        pi.on("session_before_tree", async (event) => {
          frame.resetPromptDisclosure();
          await this.flushBeforeCompaction(frame.snapshot().sessionId);
          const prepared = prepareBranchEntries(
            event.preparation.entriesToSummarize,
            this.options.provider.model.contextWindow - this.options.provider.model.maxTokens,
          );
          const indexes = compactionController.createIndexes(event.preparation.entriesToSummarize, prepared.messages);
          const summary = await compactionController.compileSummary(
            frame,
            {
              mode: "tree",
              messages: prepared.messages,
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
          midRunCompaction.resetHysteresis();
          frame.resetPromptDisclosure();
          persistPromptDisclosure(emptyAgentPiPromptDisclosureState());
        });
      },
      install: (session, settings) => {
        if (installed) return;
        installed = true;
        activeCompactionSettings = settings;
        const previous = session.agent.prepareNextTurnWithContext;
        session.agent.prepareNextTurnWithContext = async (turn, signal) => {
          const refreshed = await previous?.(turn, signal);
          const context = refreshed?.context ?? turn.context;
          const compacted = await midRunCompaction.prepareNextTurn({ ...turn, context }, session, settings, signal);
          return compacted ? { ...refreshed, context: compacted } : refreshed;
        };
      },
    };
  }

  private async flushBeforeCompaction(sessionId: string | undefined): Promise<void> {
    if (!this.options.beforeCompaction) return;
    if (!sessionId) throw new Error("Pi compaction requires a continuity session identity.");
    await this.options.beforeCompaction(sessionId);
  }
}
