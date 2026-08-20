import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  prepareBranchEntries,
  type AgentSession,
  type ExtensionFactory,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { applyAgentPiContextPolicy } from "./AgentPiContextPolicy.js";
import {
  AgentPiArtifactIndexCustomType,
  readAgentPiArtifactIndex,
  type AgentPiArtifactIndex,
} from "./AgentPiArtifactIndex.js";
import {
  AgentPiCompactionToolIndexCustomType,
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
import { renderPiSystemPromptFrame } from "./AgentPiPromptFrameProjector.js";
import { projectAgentPiToolResultStatus } from "./AgentPiToolResultPolicy.js";
import type { AgentPiProviderProjection } from "./AgentPiTypes.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";
import { AgentPiTerminalToolObservationProjector } from "./AgentPiTerminalToolObservation.js";
import { AgentPiCompactionController, type AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import { AgentPiMidRunCompactionCoordinator } from "./AgentPiMidRunCompactionCoordinator.js";
import type { AgentPiResolvedCompactionSettings } from "./AgentPiCompactionSettings.js";

export interface AgentPiRuntimeExtensionFactoryOptions {
  readonly provider: AgentPiProviderProjection;
  readonly planningCompilerFactory: AgentPiPlanningCompilerFactory;
  readonly diagnostics?: AgentPiDiagnosticSink;
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
    });
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
      return snapshot.tokenBudget
        ? applyAgentPiContextPolicy(
            bridgeResult.messages,
            snapshot.contextPolicy,
            indexes.artifactIndex.artifacts,
            snapshot.tokenBudget,
          )
        : bridgeResult.messages;
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
          return {
            systemPrompt: [
              renderPiSystemPromptFrame({
                systemPrompt: snapshot.systemPrompt ?? "",
                skills: frame.skillSnapshot(),
                selectedPromptTemplates: snapshot.selectedPromptTemplates,
              }),
              event.systemPrompt,
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
          const summarizedMessages = [
            ...event.preparation.messagesToSummarize,
            ...event.preparation.turnPrefixMessages,
          ];
          const indexes = compactionController.createIndexes(event.branchEntries, summarizedMessages);
          pendingCompactionIndex = indexes.artifactIndex;
          pendingCompactionToolIndex = indexes.toolCallIndex;
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
          const index = pendingCompactionIndex;
          pendingCompactionIndex = undefined;
          if (index && index.artifacts.length > 0) pi.appendEntry(AgentPiArtifactIndexCustomType, index);
          const toolIndex = pendingCompactionToolIndex;
          pendingCompactionToolIndex = undefined;
          if (toolIndex && toolIndex.calls.length > 0) {
            pi.appendEntry(AgentPiCompactionToolIndexCustomType, toolIndex);
          }
        });
        pi.on("context", async (event) => {
          return { messages: await projectProviderMessages(event.messages) };
        });
        pi.on("session_before_tree", async (event) => {
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
      },
      install: (session, settings) => {
        if (installed) return;
        installed = true;
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
}
