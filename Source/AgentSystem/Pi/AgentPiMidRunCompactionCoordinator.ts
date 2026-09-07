import {
  createCompactionSummaryMessage,
  type AgentContext,
  type PrepareNextTurnContext,
} from "@earendil-works/pi-agent-core";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentRunActivities } from "../Events/AgentRunEventTypes.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import type { AgentPiCompactionController, AgentPiCompactionIndexes } from "./AgentPiCompactionController.js";
import { prepareAgentPiCompaction } from "./AgentPiCompactionPreparation.js";
import type { AgentPiResolvedCompactionSettings } from "./AgentPiCompactionSettings.js";

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
  constructor(private readonly options: AgentPiMidRunCompactionCoordinatorOptions) {}

  async prepareNextTurn(
    turn: PrepareNextTurnContext,
    session: AgentSession,
    settings: AgentPiResolvedCompactionSettings,
    signal?: AbortSignal,
  ): Promise<AgentContext | undefined> {
    if (!settings.enabled || turn.toolResults.length === 0) return undefined;

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

    const run = () =>
      this.compact(
        turn,
        session,
        settings,
        projected.tokenCount,
        projected.fits,
        signal ?? new AbortController().signal,
      );
    const reporter = this.options.frame.snapshot().turnState?.context.activityReporter;
    try {
      return reporter ? await reporter.track(AgentRunActivities.CompactingContext, run) : await run();
    } catch (error) {
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
      },
      signal,
    );

    const tokenBudget = this.options.frame.snapshot().tokenBudget;
    if (!tokenBudget) throw new Error("Pi token budget disappeared during mid-run compaction.");
    const previewMessages: AgentContext["messages"] = [
      createCompactionSummaryMessage(summary, preparation.tokensBefore, new Date().toISOString()),
      ...preparation.retainedMessages,
    ];
    const previewProviderMessages = await this.options.projectProviderMessages(previewMessages, indexes);
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
      const rebased = tokenBudget.rebaseModelInput({ ...turn.context, messages: providerMessages });
      session.agent.state.messages = messages;
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
  const proactiveHeadroomTokens = Math.min(
    inputCapacityTokens,
    Math.max(0, Math.floor(budget.outputReserveTokens)),
    Math.max(0, Math.floor(settings.keepRecentTokens)),
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
