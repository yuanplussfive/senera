import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";

type AgentRequestContext = Required<Pick<AgentEventContext, "requestId">>;
type AgentVisibleAssistantContext = AgentRequestContext & Partial<Pick<AgentEventContext, "sessionId" | "step">>;

export type AgentAssistantMessageKind = "tool_preface" | "final_answer" | "ask_user";

export const AgentRunActivities = {
  PreparingContext: "preparing_context",
  InitializingRuntime: "initializing_runtime",
  SynchronizingContext: "synchronizing_context",
  EvaluatingContext: "evaluating_context",
  RunningAgentTurn: "running_agent_turn",
  GeneratingResponse: "generating_response",
  FinalizingResponse: "finalizing_response",
} as const;

export type AgentRunActivity = (typeof AgentRunActivities)[keyof typeof AgentRunActivities];

export const AgentRunActivityStates = {
  Started: "started",
  Completed: "completed",
  Failed: "failed",
} as const;

export type AgentRunActivityState = (typeof AgentRunActivityStates)[keyof typeof AgentRunActivityStates];

export type AgentRunDomainEvent =
  | {
      kind: typeof AgentEventKinds.RunStarted;
      context: AgentRequestContext;
      data: {
        input: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunActivityChanged;
      context: AgentVisibleAssistantContext;
      data: {
        activityId: string;
        activity: AgentRunActivity;
        state: AgentRunActivityState;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCancellationProgress;
      context: AgentRequestContext & Partial<Pick<AgentEventContext, "sessionId">>;
      data: {
        stage: "started" | "component_completed" | "component_failed" | "completed" | "failed";
        component?: "agent_loop" | "pi_session";
        durationMs?: number;
        message?: string;
        localizedMessage?: AgentLocalizedMessage;
      };
    }
  | {
      kind: typeof AgentEventKinds.AssistantMessageCreated;
      context: AgentVisibleAssistantContext;
      data: {
        messageId: string;
        kind: AgentAssistantMessageKind;
        content: string;
        terminal: boolean;
        toolCount?: number;
        batchId?: string;
        toolCallIds?: string[];
        reasonCode?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCompleted;
      context: AgentRequestContext;
      data: Record<string, never>;
    }
  | {
      kind: typeof AgentEventKinds.RunFailed;
      context: AgentRequestContext & Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        message: string;
        localizedMessage?: AgentLocalizedMessage;
        code?: string;
        details?: unknown;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCancelled;
      context: AgentRequestContext & Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        reason: "user_cancelled";
      };
    }
  | {
      kind: typeof AgentEventKinds.RequestInvalid;
      context: AgentEventContext;
      data: {
        /** 结构化错误码；前端据此分类，不要再匹配 message 文案 */
        code?: AgentRequestInvalidCode;
        message: string;
        localizedMessage?: AgentLocalizedMessage;
        details?: unknown;
      };
    };

export type AgentRequestInvalidCode =
  | "approval_not_pending"
  | "interaction_input_resolve_failed"
  | "request_parse_failed"
  | "tool_settings_request_failed"
  | "session_fork_boundary_missing"
  | "session_history_boundary_missing"
  | "session_fork_target_exists"
  | "session_pi_fork_failed"
  | "session_pi_unavailable";
