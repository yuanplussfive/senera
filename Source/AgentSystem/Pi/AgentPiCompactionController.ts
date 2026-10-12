import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  AgentPiArtifactIndexCustomType,
  createAgentPiArtifactIndex,
  mergeAgentPiArtifactReferences,
  readAgentPiArtifactIndex,
  type AgentPiArtifactIndex,
} from "./AgentPiArtifactIndex.js";
import {
  agentPiDiagnosticContext,
  type AgentPiCodingAgentSessionFrame,
  type AgentPiMutableSessionFrame,
} from "./AgentPiCodingAgentSessionFrame.js";
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
import { createAgentPiContinuityLedger } from "./AgentPiContinuityLedger.js";
import { AgentContinuityLedgerCustomType, mergeAgentContinuityLedger } from "../Continuity/AgentContinuityLedger.js";
import type { AgentContinuityLedger } from "../Continuity/AgentContinuityLedger.js";

export interface AgentPiCompactionIndexes {
  readonly artifactIndex: AgentPiArtifactIndex;
  readonly toolCallIndex: AgentPiCompactionToolCallIndex;
  /** Unified source/ref surface used for compaction and recovery. */
  readonly continuityLedger?: AgentContinuityLedger;
}

export interface AgentPiCompactionControllerOptions {
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly continuityScope?: () => string | undefined;
}

/** Shared owner for Pi compaction side indexes and diagnostics. */
export class AgentPiCompactionController {
  constructor(private readonly options: AgentPiCompactionControllerOptions) {}

  createIndexes(
    entries: readonly SessionEntry[],
    summarizedMessages: readonly AgentMessage[],
  ): AgentPiCompactionIndexes {
    const artifactIndex = createAgentPiArtifactIndex(readAgentPiArtifactIndex(entries).artifacts, summarizedMessages);
    const toolCallIndex = mergeAgentPiCompactionToolCallIndexes([
      readAgentPiCompactionToolCallIndex(entries).index,
      createAgentPiCompactionToolCallIndex(summarizedMessages),
    ]);
    return {
      artifactIndex,
      toolCallIndex,
      continuityLedger: createAgentPiContinuityLedger({
        scope: this.options.continuityScope?.() ?? "pi-session",
        entries,
        messages: summarizedMessages,
        artifactIndex,
        toolCallIndex,
      }),
    };
  }

  appendIndexes(sessionManager: SessionManager, indexes: AgentPiCompactionIndexes): void {
    if (indexes.artifactIndex.artifacts.length > 0) {
      sessionManager.appendCustomEntry(AgentPiArtifactIndexCustomType, indexes.artifactIndex);
    }
    if (indexes.toolCallIndex.calls.length > 0) {
      sessionManager.appendCustomEntry(AgentPiCompactionToolIndexCustomType, indexes.toolCallIndex);
    }
    if (indexes.continuityLedger) {
      sessionManager.appendCustomEntry(AgentContinuityLedgerCustomType, indexes.continuityLedger);
    }
  }

  async emitDiagnostic(
    frame: AgentPiMutableSessionFrame,
    name: string,
    details?: unknown,
    source: AgentPiDiagnosticSource = AgentPiDiagnosticSources.Session,
  ): Promise<void> {
    return this.emitDiagnosticSnapshot(frame.snapshot(), name, details, source);
  }

  async emitDiagnosticSnapshot(
    snapshot: AgentPiCodingAgentSessionFrame,
    name: string,
    details?: unknown,
    source: AgentPiDiagnosticSource = AgentPiDiagnosticSources.Session,
  ): Promise<void> {
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

/**
 * Composes independently-derived, non-overlapping branch ranges. Callers own
 * the range boundary; this helper only performs typed, duplicate-safe merges.
 */
export function mergeAgentPiCompactionIndexes(indexes: readonly AgentPiCompactionIndexes[]): AgentPiCompactionIndexes {
  const presentLedgers = indexes.flatMap((entry) => (entry.continuityLedger ? [entry.continuityLedger] : []));
  const scopes = [...new Set(presentLedgers.map((ledger) => ledger.scope))];
  if (scopes.length > 1) {
    throw new Error(`Cannot merge Pi compaction indexes from different continuity scopes: ${scopes.join(", ")}.`);
  }
  const continuityLedger = presentLedgers.reduce<AgentContinuityLedger | undefined>(
    (previous, current) => mergeAgentContinuityLedger(previous, current.scope, current.references, current.checkpoints),
    undefined,
  );
  return {
    artifactIndex: {
      artifacts: mergeAgentPiArtifactReferences(indexes.flatMap((entry) => entry.artifactIndex.artifacts)),
    },
    toolCallIndex: mergeAgentPiCompactionToolCallIndexes(indexes.map((entry) => entry.toolCallIndex)),
    ...(continuityLedger ? { continuityLedger } : {}),
  };
}
