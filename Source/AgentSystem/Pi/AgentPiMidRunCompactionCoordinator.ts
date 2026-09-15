import {
  createCompactionSummaryMessage,
  type AgentContext,
  type PrepareNextTurnContext,
} from "@earendil-works/pi-agent-core";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentRunActivities } from "../Events/AgentRunEventTypes.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import type { AgentPiCompactionController, AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import { prepareAgentPiCompaction } from "./AgentPiCompactionPreparation.js";
import {
  resolveAgentPiCompactionHeadroom,
  type AgentPiResolvedCompactionSettings,
} from "./AgentPiCompactionSettings.js";

export interface AgentPiMidRunCompactionCoordinatorOptions {
  readonly frame: AgentPiMutableSessionFrame;
  readonly sessionManager: SessionManager;
  readonly compactionController: AgentPiCompactionController;
  readonly projectProviderMessages: (
    messages: AgentContext["messages"],
    compactionIndexes?: AgentPiCompactionIndexes,
  ) => Promise<AgentContext["messages"]>;
}

export interface AgentPiMidRunCompactionPressure {
  readonly inputCapacityTokens: number;
  readonly proactiveHeadroomTokens: number;
  readonly triggerTokens: number;
}

/** Compacts a live Pi tool loop before the next provider request can overflow. */
export class AgentPiMidRunCompactionCoordinator {
  private lastCompactionAfterTokens: number | undefined;
  private lastCompactionLeafId: string | undefined;

  constructor(private readonly options: AgentPiMidRunCompactionCoordinatorOptions) {}

  resetHysteresis(): void {
    this.lastCompactionAfterTokens = undefined;
    this.lastCompactionLeafId = undefined;
  }

  async prepareNextTurn(
    turn: PrepareNextTurnContext,
    session: AgentSession,
    settings: AgentPiResolvedCompactionSettings,
    signal?: AbortSignal,
  ): Promise<AgentContext | undefined> {
    if (!settings.enabled || turn.toolResults.length === 0) return undefined;

    const compactionSignal = signal ?? new AbortController().signal;
    // Mid-run compaction is outside Pi's own auto-compaction controller. Check
    // the turn signal at both boundaries so a user cancellation cannot be
    // swallowed by the best-effort "projected input still fits" path below.
    throwIfAborted(compactionSignal);

    const tokenBudget = this.options.frame.snapshot().tokenBudget;
    if (!tokenBudget) return undefined;
    const projected = tokenBudget.projectNextProviderInput({
      assistant: turn.message,
      toolResults: turn.toolResults,
    });
    const pressure = resolveAgentPiMidRunCompactionPressure(tokenBudget.snapshot(), settings);
    if (projected.tokenCount <= pressure.triggerTokens) {
      await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.mid_turn.skipped", {
        reason: "below_trigger",
        projectedTokens: projected.tokenCount,
        ...pressure,
      });
      return undefined;
    }

    // A large current tool result can leave the rebuilt context above the
    // pressure band. Do not summarize the same history repeatedly when no
    // additional input has accumulated since the last persisted compaction.
    // If the projected request does not fit, let the normal hard-cap error
    // surface instead of silently sending an oversized request.
    const currentLeafId = this.options.sessionManager.getBranch().at(-1)?.id;
    if (
      this.lastCompactionAfterTokens !== undefined &&
      currentLeafId === this.lastCompactionLeafId &&
      projected.previousTokenCount <= this.lastCompactionAfterTokens
    ) {
      await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.mid_turn.skipped", {
        reason: "hysteresis_no_growth",
        projectedTokens: projected.tokenCount,
        previousCompactionTokens: this.lastCompactionAfterTokens,
        ...pressure,
      });
      if (projected.fits) return undefined;
      throw new Error(
        `Pi mid-run compaction cannot continue: the context remains above the pressure band after the last compaction and the next provider input uses ${projected.tokenCount} tokens for a capacity of ${projected.capacityTokens}.`,
      );
    }

    const run = () => this.compact(turn, session, settings, projected.tokenCount, projected.fits, compactionSignal);
    const reporter = this.options.frame.snapshot().turnState?.context.activityReporter;
    try {
      const result = reporter ? await reporter.track(AgentRunActivities.CompactingContext, run) : await run();
      throwIfAborted(compactionSignal);
      return result;
    } catch (error) {
      throwIfAborted(compactionSignal);
      await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.mid_turn.failed", {
        message: errorMessage(error),
        projectedTokens: projected.tokenCount,
        ...pressure,
      });
      if (!projected.fits || error instanceof AgentPiPersistedCompactionError) throw error;
      return undefined;
    }
  }

  private async compact(
    turn: PrepareNextTurnContext,
    session: AgentSession,
    settings: AgentPiResolvedCompactionSettings,
    projectedTokens: number,
    projectedFits: boolean,
    signal: AbortSignal,
  ): Promise<AgentContext | undefined> {
    const branchEntries = this.options.sessionManager.getBranch();
    const preparation = prepareAgentPiCompaction(branchEntries, settings, projectedTokens);
    throwIfAborted(signal);
    if (!preparation) {
      await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.mid_turn.skipped", {
        reason: "no_eligible_history",
        projectedTokens,
      });
      if (projectedFits) return undefined;
      throw new Error(
        `Pi mid-run compaction cannot continue: no completed history is eligible for a turn-safe cut while the projected input uses ${projectedTokens} tokens.`,
      );
    }

    const summarizedMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
    const indexes = this.options.compactionController.createIndexes(branchEntries, summarizedMessages);
    await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.mid_turn.started", {
      projectedTokens,
      summarizedMessages: summarizedMessages.length,
      firstKeptEntryId: preparation.firstKeptEntryId,
    });
    const summary = await this.options.compactionController.compileSummary(
      this.options.frame,
      {
        mode: "compact",
        messages: summarizedMessages,
        previousSummary: preparation.previousSummary,
        artifactIndex: indexes.artifactIndex,
        toolCallIndex: indexes.toolCallIndex,
        continuityLedger: indexes.continuityLedger,
      },
      signal,
    );
    throwIfAborted(signal);

    const tokenBudget = this.options.frame.snapshot().tokenBudget;
    if (!tokenBudget) throw new Error("Pi token budget disappeared during mid-run compaction.");
    const previewMessages: AgentContext["messages"] = [
      createCompactionSummaryMessage(summary, preparation.tokensBefore, new Date().toISOString()),
      ...preparation.retainedMessages,
    ];
    const previewProviderMessages = await this.options.projectProviderMessages(previewMessages, indexes);
    throwIfAborted(signal);
    const preview = tokenBudget.inspectModelInput({ ...turn.context, messages: previewProviderMessages });
    if (!preview.fits) {
      await this.options.compactionController.emitDiagnostic(
        this.options.frame,
        "compaction.mid_turn.insufficient_capacity",
        {
          projectedTokens,
          compactedTokens: preview.tokenCount,
          capacityTokens: preview.capacityTokens,
          retainedMessages: preparation.retainedMessages.length,
        },
      );
      throw new Error(
        `Pi mid-run compaction cannot fit the completed tool batch: its irreducible projected context uses ${preview.tokenCount} tokens but capacity is ${preview.capacityTokens}.`,
      );
    }

    let persisted = false;
    try {
      // The append is synchronous. Once this check passes, the event loop
      // cannot interleave a cancellation before the append-only mutation.
      throwIfAborted(signal);
      this.options.sessionManager.appendCompaction(
        summary,
        preparation.firstKeptEntryId,
        preparation.tokensBefore,
        indexes,
        true,
      );
      persisted = true;
      this.options.compactionController.appendIndexes(this.options.sessionManager, indexes);
      const messages = this.options.sessionManager.buildSessionContext().messages;
      const providerMessages = await this.options.projectProviderMessages(messages);
      throwIfAborted(signal);
      const rebased = tokenBudget.rebaseModelInput({ ...turn.context, messages: providerMessages });
      session.agent.state.messages = messages;
      this.lastCompactionAfterTokens = rebased.tokenCount;
      this.lastCompactionLeafId = this.options.sessionManager.getBranch().at(-1)?.id;
      await this.options.compactionController.emitDiagnostic(this.options.frame, "compaction.mid_turn.completed", {
        tokensBefore: preparation.tokensBefore,
        tokensAfter: rebased.tokenCount,
        summarizedMessages: summarizedMessages.length,
        retainedMessages: messages.length,
      });
      return { ...turn.context, messages };
    } catch (error) {
      throw persisted ? new AgentPiPersistedCompactionError(error) : error;
    }
  }
}

export function resolveAgentPiMidRunCompactionPressure(
  budget: { readonly inputCapacityTokens: number; readonly outputReserveTokens: number },
  settings: Pick<AgentPiResolvedCompactionSettings, "keepRecentTokens">,
): AgentPiMidRunCompactionPressure {
  const inputCapacityTokens = Math.max(0, Math.floor(budget.inputCapacityTokens));
  const proactiveHeadroomTokens = resolveAgentPiCompactionHeadroom(
    inputCapacityTokens,
    budget.outputReserveTokens,
    settings.keepRecentTokens,
  );
  return {
    inputCapacityTokens,
    proactiveHeadroomTokens,
    triggerTokens: inputCapacityTokens - proactiveHeadroomTokens,
  };
}

class AgentPiPersistedCompactionError extends Error {
  constructor(cause: unknown) {
    super(`Pi mid-run compaction was persisted but its active context could not be rebuilt: ${errorMessage(cause)}`, {
      cause,
    });
    this.name = "AgentPiPersistedCompactionError";
  }
}
