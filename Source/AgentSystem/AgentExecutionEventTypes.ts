import { AgentEventKinds } from "./AgentEventCatalog.js";
import type { AgentEventContext } from "./AgentEventBase.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { AgentActionPlannerStageName } from "./AgentActionPlannerTelemetry.js";

export type AgentExecutionDomainEvent =
  | {
      kind: typeof AgentEventKinds.RunStarted;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: {
        input: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.PromptRendered;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        prompt: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.PromptSummary;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        chars: number;
        lines: number;
        tokenCount: number;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageStarted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stage: AgentActionPlannerStageName;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageCompleted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stage: AgentActionPlannerStageName;
        selectedAction?: string;
        repaired?: boolean;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlannerStageFailed;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stage: AgentActionPlannerStageName;
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ActionPlanned;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        status: "planned" | "fallback";
        action?: string;
        expectedOutputMode?: "tool_call_xml" | "final_text" | "open";
        instruction?: string;
        answerPreview?: string;
        askUserQuestion?: string;
        capabilityNeeds?: Array<{
          actions: string[];
          targets: string[];
          inputs: string[];
          outputs: string[];
          evidence: string[];
          effects: string[];
        }>;
        preferredTools: string[];
        toolSearchQueries: string[];
        loadedTools: string[] | "all";
        currentStep?: number;
        runState?: {
          totalToolCalls: number;
          totalEvidence: number;
          repeatedCallCount: number;
          stalled: boolean;
          timelineTurnCount: number;
        };
        selectedAction?: string;
        selectionRepaired?: boolean;
        payloadRepaired?: boolean;
        reason?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStarted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        model: string;
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStreamOpened;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelDelta;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        text: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelCompleted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        text: string;
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStreamAborted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        reason: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.FinalAnswer;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: {
        content: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.AskUser;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: {
        question: string;
        reasonCode?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCompleted;
      context: Required<Pick<AgentEventContext, "requestId">>;
      data: Record<string, never>;
    }
  | {
      kind: typeof AgentEventKinds.RunFailed;
      context: Required<Pick<AgentEventContext, "requestId">> &
        Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        message: string;
        code?: string;
        details?: unknown;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCancelled;
      context: Required<Pick<AgentEventContext, "requestId">> &
        Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        reason: "user_cancelled";
      };
    }
  | {
      kind: typeof AgentEventKinds.RequestInvalid;
      context: AgentEventContext;
      data: {
        message: string;
        details?: unknown;
      };
    };
