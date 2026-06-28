import { AgentEventKinds } from "../AgentEventCatalog.js";
import type { AgentEventContext } from "../AgentEventBase.js";
import type { AgentRetryInstruction } from "../AgentRetryableError.js";

export type AgentDecisionDomainEvent =
  | {
      kind: typeof AgentEventKinds.DecisionXmlProgress;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        state: string;
        xml: string;
        kind: "final_answer" | "ask_user" | "tool_calls" | "unknown";
        text: string;
        preambleText: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.DecisionXmlReady;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        stopReason: "root_closed" | "stream_completed";
      };
    }
  | {
      kind: typeof AgentEventKinds.DecisionXmlLimitReached;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        code: string;
        model: string;
        encodingName: string;
        tokenCount: number;
        tokenLimit: number;
        exceededTokens: number;
        resolution: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.DecisionXmlSummary;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        chars: number;
        lines: number;
        root?: string;
        sanitized: boolean;
        detailId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.DecisionXmlDetail;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        detailId: string;
        xml: string;
        rawXml?: string;
        sanitized: boolean;
      };
    }
  | {
      kind: typeof AgentEventKinds.DecisionParsed;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        root: string;
        decisionKind: string;
        detailId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.DecisionParsedDetail;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        detailId: string;
        root: string;
        decisionKind: string;
        payload: unknown;
      };
    }
  | {
      kind: typeof AgentEventKinds.RetryPlanned;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        attempt: number;
        code: string;
        message: string;
        retryable: boolean;
        detailId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.RetryDetail;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        detailId: string;
        instruction: AgentRetryInstruction;
      };
    };
