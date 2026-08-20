import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  AgentPiArtifactIndexCustomType,
  createAgentPiArtifactIndex,
  readAgentPiArtifactIndex,
  type AgentPiArtifactIndex,
} from "./AgentPiArtifactIndex.js";
import { agentPiDiagnosticContext, type AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import {
  AgentPiCompactionToolIndexCustomType,
  createAgentPiCompactionToolCallIndex,
  mergeAgentPiCompactionToolCallIndexes,
  readAgentPiCompactionToolCallIndex,
  type AgentPiCompactionToolCallIndex,
} from "./AgentPiCompactionToolIndex.js";
import {
  AgentPiDiagnosticSources,
  emitAgentPiDiagnostic,
  type AgentPiDiagnosticSink,
  type AgentPiDiagnosticSource,
} from "./AgentPiDiagnostics.js";
import type { AgentPiPlanningCompilerFactory } from "./AgentPiPlanningCompiler.js";

export interface AgentPiCompactionIndexes {
  readonly artifactIndex: AgentPiArtifactIndex;
  readonly toolCallIndex: AgentPiCompactionToolCallIndex;
}

export interface AgentPiCompactionControllerOptions {
  readonly planningCompilerFactory: AgentPiPlanningCompilerFactory;
  readonly diagnostics?: AgentPiDiagnosticSink;
}

/** Shared owner for Senera compaction summaries and persisted retrieval indexes. */
export class AgentPiCompactionController {
  constructor(private readonly options: AgentPiCompactionControllerOptions) {}

  createIndexes(
    entries: readonly SessionEntry[],
    summarizedMessages: readonly AgentMessage[],
  ): AgentPiCompactionIndexes {
    return {
      artifactIndex: createAgentPiArtifactIndex(readAgentPiArtifactIndex(entries).artifacts, summarizedMessages),
      toolCallIndex: mergeAgentPiCompactionToolCallIndexes([
        readAgentPiCompactionToolCallIndex(entries).index,
        createAgentPiCompactionToolCallIndex(summarizedMessages),
      ]),
    };
  }

  compileSummary(
    frame: AgentPiMutableSessionFrame,
    input: Parameters<ReturnType<AgentPiPlanningCompilerFactory["create"]>["summarize"]>[0],
    signal: AbortSignal,
  ): Promise<string> {
    const snapshot = frame.snapshot();
    return this.options.planningCompilerFactory
      .create({
        usageSink: (call) => snapshot.turnState?.context.usageLedger.record(call),
        timingSink: (timing) =>
          this.emitDiagnostic(frame, "compaction.model_timing", timing, AgentPiDiagnosticSources.Provider),
      })
      .summarize(input, signal);
  }

  appendIndexes(sessionManager: SessionManager, indexes: AgentPiCompactionIndexes): void {
    if (indexes.artifactIndex.artifacts.length > 0) {
      sessionManager.appendCustomEntry(AgentPiArtifactIndexCustomType, indexes.artifactIndex);
    }
    if (indexes.toolCallIndex.calls.length > 0) {
      sessionManager.appendCustomEntry(AgentPiCompactionToolIndexCustomType, indexes.toolCallIndex);
    }
  }

  async emitDiagnostic(
    frame: AgentPiMutableSessionFrame,
    name: string,
    details?: unknown,
    source: AgentPiDiagnosticSource = AgentPiDiagnosticSources.Session,
  ): Promise<void> {
    const snapshot = frame.snapshot();
    try {
      await emitAgentPiDiagnostic(snapshot.diagnostics ?? this.options.diagnostics, {
        context: agentPiDiagnosticContext(snapshot),
        source,
        name,
        details,
      });
    } catch {
      // Diagnostics are observational and must not change compaction behavior.
    }
  }
}
