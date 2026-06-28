import type { AgentEventSink } from "../AgentEvent.js";
import type { AgentTextBudgetEvaluator, AgentExceededTextBudgetSnapshot } from "../AgentTextBudget.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActionMismatchRepairPromptBuilder } from "../ActionPlanner/AgentActionMismatchRepairPromptBuilder.js";
import type { AgentXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import type { AgentXmlCandidateNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";
import type { AgentLanguageModel, AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { RegisteredDecisionAction } from "../Types/PluginRuntimeTypes.js";

export type DecisionXmlCollectionResult =
  | {
      kind: "tool_calls";
      text: string;
      toolCallsXml: string;
      stopReason: "root_closed" | "stream_completed";
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "final_text";
      text: string;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "token_limit";
      text: string;
      budget: AgentExceededTextBudgetSnapshot;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    };

export interface AgentDecisionXmlCollectorOptions {
  model: AgentLanguageModel;
  policy: AgentXmlProtocolPolicy;
  textBudget: AgentTextBudgetEvaluator;
  tokenEstimator: {
    estimate(text: string): {
      tokenCount: number;
    };
  };
  decisionActions?: readonly Pick<RegisteredDecisionAction, "kind" | "xmlRoot">[];
  candidateNormalizer?: AgentXmlCandidateNormalizer;
  actionMismatchRepairPromptBuilder: AgentActionMismatchRepairPromptBuilder;
}

export interface AgentDecisionXmlCollectRequest {
  requestId: string;
  step: number;
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  rootCommand?: AgentRootCommand;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}
