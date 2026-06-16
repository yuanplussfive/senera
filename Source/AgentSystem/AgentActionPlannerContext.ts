import type { ActionPlanInput } from "./BamlClient/baml_client/types.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import type { ExecutedToolCallResult } from "./Types.js";
import type { AgentToolCatalogItem } from "./AgentToolCatalogProjector.js";
import {
  DefaultAgentArtifactRootDir,
} from "./Artifacts/AgentArtifactLocator.js";
import {
  AgentActionPlannerLedgerUpdater,
  isActionPlannerLedgerStalled,
  type AgentActionPlannerLedger,
} from "./AgentActionPlannerLedger.js";
import { AgentActionPlannerTimelineProjector } from "./AgentActionPlannerTimelineProjector.js";
import {
  AgentPlannerMemoryProjector,
} from "./AgentPlannerMemory.js";

export type {
  AgentActionPlannerLedger,
  PlannerEvidenceRecord,
  PlannerExecutionDelta,
  PlannerRepeatedCallWarning,
  PlannerToolCallRecord,
} from "./AgentActionPlannerLedger.js";
export {
  buildInitialActionPlannerLedger,
  EmptyActionPlannerLedger,
} from "./AgentActionPlannerLedger.js";

export class AgentActionPlannerContextBuilder {
  private readonly ledgerUpdater: AgentActionPlannerLedgerUpdater;
  private readonly timelineProjector: AgentActionPlannerTimelineProjector;
  private readonly memoryProjector: AgentPlannerMemoryProjector;

  constructor(
    workspaceRoot: string = process.cwd(),
    artifactRootDir: string = DefaultAgentArtifactRootDir,
  ) {
    this.ledgerUpdater = new AgentActionPlannerLedgerUpdater(workspaceRoot, artifactRootDir);
    this.timelineProjector = new AgentActionPlannerTimelineProjector();
    this.memoryProjector = new AgentPlannerMemoryProjector();
  }

  buildInput(options: {
    requestId?: string;
    userMessage: string;
    currentStep: number;
    dynamicTools: boolean;
    loadedToolNames: "all" | readonly string[];
    messages: readonly AgentLanguageModelMessage[];
    conversationEntries?: readonly AgentConversationEntry[];
    ledger: AgentActionPlannerLedger;
    toolCatalog: AgentToolCatalogItem[];
  }): ActionPlanInput {
    const loadedTools = options.loadedToolNames === "all"
      ? options.toolCatalog.map((tool) => tool.name)
      : [...options.loadedToolNames];
    const visibleTools = new Set(loadedTools);
    const memory = this.memoryProjector.project(options.conversationEntries ?? [], {
      excludeEvidenceRequestId: options.requestId,
    });

    void options.userMessage;
    return {
      runState: {
        currentStep: options.currentStep,
        dynamicTools: options.dynamicTools,
        loadedTools,
        progress: {
          totalToolCalls: options.ledger.calls.length,
          totalEvidence: options.ledger.evidence.length,
          lastNewEvidenceStep: options.ledger.lastNewEvidenceStep,
          repeatedCallCount: options.ledger.warnings.length,
          stalled: isActionPlannerLedgerStalled(options.currentStep, options.ledger),
        },
        warnings: options.ledger.warnings,
      },
      timeline: this.timelineProjector.project({
        messages: options.messages,
        ledger: options.ledger,
      }),
      evidenceMemory: memory.evidenceMemory,
      plannerJournal: memory.plannerJournal,
      toolCatalog: options.toolCatalog.map((tool) => ({
        ...tool,
        loaded: visibleTools.has(tool.name),
      })),
    };
  }

  advanceAfterToolResults(options: {
    requestId?: string;
    ledger: AgentActionPlannerLedger;
    step: number;
    results: readonly ExecutedToolCallResult[];
  }): AgentActionPlannerLedger {
    return this.ledgerUpdater.advanceAfterToolResults(options);
  }
}
