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

export interface AgentPiRuntimeExtensionFactoryOptions {
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly beforeCompaction?: (sessionId: string) => Promise<void>;
  readonly afterCompaction?: (sessionId: string) => Promise<void> | void;
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
    let extensionApi: ExtensionAPI | undefined;
    let pendingCompaction: AgentPiCompactionIndexes | undefined;
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
        pi.on("before_agent_start", (event) => {
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
          const indexes = takePendingCompaction();
          if (indexes) compactionController.appendIndexes(sessionManager, indexes);
          await this.invalidateAfterCompaction(frame.snapshot().sessionId);
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

  private async invalidateAfterCompaction(sessionId: string | undefined): Promise<void> {
    if (!this.options.afterCompaction) return;
    if (!sessionId) throw new Error("Pi compaction requires a continuity session identity.");
    await this.options.afterCompaction(sessionId);
  }
}
