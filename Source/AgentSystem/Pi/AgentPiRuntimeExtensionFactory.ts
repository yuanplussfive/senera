import {
  type ExtensionFactory,
  type ExtensionAPI,
  type ToolDefinition,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { renderAgentPiSkillLibraryPrompt } from "./AgentPiSkillLibraryPrompt.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import { AgentPiCompactionController, type AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import { AgentPiTerminalToolObservationProjector } from "./AgentPiTerminalToolObservation.js";
import { projectAgentPiToolResultStatus } from "./AgentPiToolResultPolicy.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentToolResultObservationCompressor } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import { projectAgentPiMemorySystemPrompt } from "./AgentPiMemoryBoundary.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import { readAgentPiCommittedReceipts } from "./AgentPiInputBoundary.js";
import { AgentPiToolCompositionState } from "./AgentPiToolCompositionState.js";

export interface AgentPiRuntimeExtensionFactoryOptions {
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly beforeCompaction?: (sessionId: string) => Promise<void>;
  readonly afterCompaction?: (sessionId: string, boundaryKey?: string) => Promise<void> | void;
  readonly observationCompressor: AgentToolResultObservationCompressor;
  readonly observationTokenBudget: number;
}

export interface AgentPiRuntimeExtensionRegistration {
  readonly name: string;
  readonly hidden: true;
  readonly factory: ExtensionFactory;
  registerTools(tools: readonly ToolDefinition[]): void;
}

/**
 * Installs Senera's non-authoritative Pi hooks.
 *
 * Pi owns the compaction boundary, summary generation, retained messages, and
 * tree summaries. Senera only flushes continuity state before that boundary
 * and persists typed indexes after Pi has committed its native entry.
 */
export class AgentPiRuntimeExtensionFactory {
  constructor(private readonly options: AgentPiRuntimeExtensionFactoryOptions) {}

  create(frame: AgentPiMutableSessionFrame, sessionManager: SessionManager): AgentPiRuntimeExtensionRegistration {
    frame.setCompositionState(new AgentPiToolCompositionState(sessionManager));
    let extensionApi: ExtensionAPI | undefined;
    let pendingCompaction: AgentPiCompactionIndexes | undefined;
    let memoryProjection: { revision: number; previousHostPrompt: string; currentHostPrompt: string } | undefined;
    let lastCompactionId: string | undefined;
    const previousPreparer = frame.snapshot().prepareModelInput;
    frame.setModelInputPreparer(async (context) => {
      await inputBoundary("observe");
      const prepared = previousPreparer ? await previousPreparer(context) : context;
      return memoryProjection?.revision === frame.revision()
        ? projectAgentPiMemorySystemPrompt(
            prepared,
            memoryProjection.previousHostPrompt,
            memoryProjection.currentHostPrompt,
          )
        : prepared;
    });
    const inputBoundary = async (phase: import("./AgentPiInputBoundary.js").AgentPiInputBoundary["phase"]) => {
      const snapshot = frame.snapshot();
      if (!snapshot.inputBoundary) return;
      const { inputs: committedInputs, toolCalls: committedToolCalls } = readAgentPiCommittedReceipts(sessionManager);
      await snapshot.inputBoundary({
        phase,
        committedInputs,
        committedToolCalls,
      });
    };
    const clearPendingCompaction = () => {
      pendingCompaction = undefined;
    };
    const takePendingCompaction = () => {
      const value = pendingCompaction;
      clearPendingCompaction();
      return value;
    };
    const terminalToolObservations = new AgentPiTerminalToolObservationProjector(
      this.options.observationCompressor,
      this.options.observationTokenBudget,
    );
    const compactionController = new AgentPiCompactionController({
      diagnostics: this.options.diagnostics,
      continuityScope: () => frame.snapshot().sessionId ?? frame.snapshot().logicalCacheScope,
    });

    return {
      name: "senera-runtime",
      hidden: true,
      registerTools: (tools) => {
        if (!extensionApi) throw new Error("Pi runtime extension must be loaded before registering discovered tools.");
        for (const tool of tools) extensionApi.registerTool(tool);
      },
      factory: (pi) => {
        extensionApi = pi;
        pi.on("before_agent_start", async (event) => {
          await inputBoundary("start");
          const snapshot = frame.snapshot();
          memoryProjection = undefined;
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
        pi.on("turn_end", async (event) => {
          await inputBoundary(event.outcome === "completed" ? "steer" : "observe");
        });
        pi.on("agent_before_settle", async (event) => {
          await inputBoundary(event.outcome === "completed" ? "follow_up" : "observe");
        });
        pi.on("tool_call", async (event) => {
          const snapshot = frame.snapshot();
          if (event.parentToolCallId) {
            const state = snapshot.turnState;
            if (!state) throw new Error("Nested tool execution requires an active turn.");
            const batchId = state.registerNestedToolCall(event.parentToolCallId, {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
            });
            await state.beginWorkspaceChangeBatch(batchId, [
              { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input },
            ]);
            await emitAgentEvent(snapshot.onEvent, {
              kind: AgentEventKinds.ToolCallsPlanned,
              context: {
                sessionId: snapshot.sessionId,
                requestId: snapshot.requestId ?? state.context.requestId,
                step: snapshot.step ?? state.context.step,
                scope: { parentToolCallId: event.parentToolCallId },
              },
              data: {
                toolCount: 1,
                tools: [event.toolName],
                batchId,
                calls: [
                  {
                    callId: event.toolCallId,
                    toolName: event.toolName,
                    origin: snapshot.toolOriginLookup?.(event.toolName),
                  },
                ],
                status: "planned",
                executionMode: "parallel",
              },
            });
          }
          return snapshot.preflight({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
            parentToolCallId: event.parentToolCallId,
          });
        });
        pi.on("tool_result", (event) => projectAgentPiToolResultStatus(event.details));
        pi.on("tool_execution_end", (event) => terminalToolObservations.settle(frame.snapshot().turnState, event));
        pi.on("message_end", (event) => {
          const replacement = terminalToolObservations.replaceMessage(event.message);
          return replacement ? { message: replacement } : undefined;
        });
        pi.on("session_before_compact", async (event) => {
          clearPendingCompaction();
          await this.flushBeforeCompaction(frame.snapshot().sessionId);
          const messagesToSummarize = [
            ...event.preparation.messagesToSummarize,
            ...event.preparation.turnPrefixMessages,
          ];
          pendingCompaction = compactionController.createIndexes(event.branchEntries, messagesToSummarize);
          await compactionController.emitDiagnostic(frame, "compaction.native.deferred", {
            reason: event.reason,
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            summarizedMessages: messagesToSummarize.length,
          });
          return undefined;
        });
        pi.on("session_compact", async (event) => {
          if (lastCompactionId === event.compactionEntry.id) return;
          const committedFrame = frame.snapshot();
          if (committedFrame.sessionId) {
            await emitAgentEvent(committedFrame.onEvent, {
              kind: AgentEventKinds.SessionCompacted,
              context: {
                sessionId: committedFrame.sessionId,
                requestId: committedFrame.requestId,
                step: committedFrame.step,
              },
              data: {
                sessionId: committedFrame.sessionId,
                tokensBefore: event.compactionEntry.tokensBefore,
                boundaryId: event.compactionEntry.id,
              },
            });
          }
          const indexes = takePendingCompaction();
          if (indexes) compactionController.appendIndexes(sessionManager, indexes);
          await this.invalidateAfterCompaction(frame.snapshot().sessionId, event.compactionEntry.id);
          const snapshot = frame.snapshot();
          const revision = frame.revision();
          if (!snapshot.signal?.aborted && snapshot.refreshMemoryBoundary) {
            const previousHostPrompt =
              memoryProjection?.revision === revision
                ? memoryProjection.previousHostPrompt
                : (snapshot.systemPrompt ?? "");
            await frame.refreshMemoryBoundary({ id: event.compactionEntry.id, summary: event.compactionEntry.summary });
            if (revision === frame.revision())
              memoryProjection = {
                revision,
                previousHostPrompt,
                currentHostPrompt: frame.snapshot().systemPrompt ?? "",
              };
          }
          lastCompactionId = event.compactionEntry.id;
          void compactionController.emitDiagnostic(frame, "compaction.native.completed", {
            reason: event.reason,
            fromExtension: event.fromExtension,
            firstKeptEntryId: event.compactionEntry.firstKeptEntryId,
          });
        });
        pi.on("session_compact_failed", (event) => {
          const hadPendingIndexes = takePendingCompaction() !== undefined;
          if (!hadPendingIndexes) return;
          void compactionController.emitDiagnostic(frame, "compaction.native.failed", {
            reason: event.reason,
            aborted: event.aborted,
            errorMessage: event.errorMessage,
          });
        });
        pi.on("session_shutdown", () => {
          clearPendingCompaction();
        });
      },
    };
  }

  private async flushBeforeCompaction(sessionId: string | undefined): Promise<void> {
    if (!this.options.beforeCompaction) return;
    if (!sessionId) throw new Error("Pi compaction requires a continuity session identity.");
    await this.options.beforeCompaction(sessionId);
  }

  private async invalidateAfterCompaction(sessionId: string | undefined, boundaryKey: string): Promise<void> {
    if (!this.options.afterCompaction) return;
    if (!sessionId) throw new Error("Pi compaction requires a continuity session identity.");
    await this.options.afterCompaction(sessionId, boundaryKey);
  }
}
