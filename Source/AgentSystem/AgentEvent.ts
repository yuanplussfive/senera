import type { AgentRetryInstruction } from "./AgentRetryableError.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { AgentModelProviderListItem } from "./Types.js";
import { readXmlRootName } from "./AgentXmlRootReader.js";

export const AgentEventLayers = {
  Progress: "progress",
  Snapshot: "snapshot",
  Terminal: "terminal",
  Error: "error",
} as const;

export type AgentEventLayer =
  typeof AgentEventLayers[keyof typeof AgentEventLayers];

export const AgentEventPhases = {
  Request: "request",
  Session: "session",
  Prompt: "prompt",
  Model: "model",
  Decision: "decision",
  Retry: "retry",
  Tool: "tool",
  Run: "run",
  Config: "config",
} as const;

export type AgentEventPhase =
  typeof AgentEventPhases[keyof typeof AgentEventPhases];

export const AgentEventKinds = {
  SessionCreated: "session.created",
  SessionSnapshot: "session.snapshot",
  SessionClosed: "session.closed",
  SessionBusy: "session.busy",
  SessionNotFound: "session.not_found",
  SessionListSnapshot: "session.list.snapshot",
  SessionHistorySnapshot: "session.history.snapshot",
  SessionTruncated: "session.truncated",
  RunStarted: "run.started",
  PromptRendered: "prompt.rendered",
  PromptSummary: "prompt.summary",
  ModelStarted: "model.started",
  ModelStreamOpened: "model.stream.opened",
  ModelDelta: "model.delta",
  ModelCompleted: "model.completed",
  ModelStreamAborted: "model.stream.aborted",
  DecisionXmlProgress: "decision.xml.progress",
  DecisionXmlReady: "decision.xml.ready",
  DecisionXmlLimitReached: "decision.xml.limit_reached",
  DecisionXmlSummary: "decision.xml.summary",
  DecisionXmlDetail: "decision.xml.detail",
  DecisionParsed: "decision.parsed",
  DecisionParsedDetail: "decision.parsed.detail",
  RetryPlanned: "retry.planned",
  RetryDetail: "retry.detail",
  ToolCallsPlanned: "tool.calls.planned",
  ToolCallStarted: "tool.call.started",
  ToolCallCompleted: "tool.call.completed",
  ToolCallFailed: "tool.call.failed",
  ToolResults: "tool.results",
  ToolResultsDetail: "tool.results.detail",
  FinalAnswer: "final.answer",
  AskUser: "ask.user",
  RunCompleted: "run.completed",
  RunFailed: "run.failed",
  RunCancelled: "run.cancelled",
  RequestInvalid: "request.invalid",
  ConfigReloaded: "config.reloaded",
  ConfigFailed: "config.failed",
  ModelListSnapshot: "model.list.snapshot",
  ProfileSnapshot: "profile.snapshot",
} as const;

export type AgentEventKind =
  typeof AgentEventKinds[keyof typeof AgentEventKinds];

export const AgentEventChannels = {
  AgentEvent: "agent.event",
} as const;

export type AgentEventChannel =
  typeof AgentEventChannels[keyof typeof AgentEventChannels];

export interface AgentEventEnvelope<TKind extends string = AgentEventKind, TData = unknown> {
  channel: AgentEventChannel;
  kind: TKind;
  layer: AgentEventLayer;
  phase: AgentEventPhase;
  sequence: number;
  timestamp: string;
  sessionId?: string;
  requestId?: string;
  step?: number;
  detailId?: string;
  data: TData;
}

export interface AgentEventContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
}

export type AgentDomainEvent =
  | {
      kind: typeof AgentEventKinds.SessionCreated;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        entryCount: number;
        messageCount: number;
        turnCount: number;
        activeRequestId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionSnapshot;
      context: Required<Pick<AgentEventContext, "sessionId">> & Partial<Pick<AgentEventContext, "requestId">>;
      data: {
        sessionId: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        entryCount: number;
        messageCount: number;
        turnCount: number;
        activeRequestId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionClosed;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        status: string;
        createdAt: string;
        updatedAt: string;
        entryCount: number;
        messageCount: number;
        turnCount: number;
        activeRequestId?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionBusy;
      context: Required<Pick<AgentEventContext, "sessionId">> & Partial<Pick<AgentEventContext, "requestId">>;
      data: {
        sessionId: string;
        activeRequestId: string;
        rejectedRequestId?: string;
        operation: "session.message" | "session.close";
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionNotFound;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        operation: "session.message" | "session.close" | "session.history";
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionListSnapshot;
      context: AgentEventContext;
      data: {
        sessions: Array<{
          sessionId: string;
          title: string;
          status: string;
          createdAt: string;
          updatedAt: string;
          entryCount: number;
          messageCount: number;
        }>;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionHistorySnapshot;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        totalEntries: number;
        messageCount: number;
        entries: Array<{
          entry: import("./AgentConversation.js").AgentConversationEntry;
          visible?: {
            kind: string;
            text: string;
          };
        }>;
      };
    }
  | {
      kind: typeof AgentEventKinds.SessionTruncated;
      context: Required<Pick<AgentEventContext, "sessionId">>;
      data: {
        sessionId: string;
        fromRequestId: string;
        removedEntries: number;
      };
    }
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
      kind: typeof AgentEventKinds.DecisionXmlProgress;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        state: string;
        xml: string;
        /** 已剥离 CDATA 与实体转义的用户可见文本（流式逐步增长） */
        kind: "final_answer" | "ask_user" | "tool_calls" | "unknown";
        text: string;
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
    }
  | {
      kind: typeof AgentEventKinds.ToolCallsPlanned;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        toolCount: number;
        tools: string[];
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallStarted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        index: number;
        toolName: string;
        callId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallCompleted;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        index: number;
        toolName: string;
        callId: string;
        preview?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolCallFailed;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        index: number;
        toolName: string;
        callId: string;
        code?: string;
        message: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolResults;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        toolCount: number;
        detailId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ToolResultsDetail;
      context: Required<Pick<AgentEventContext, "requestId" | "step">>;
      data: {
        detailId: string;
        xml: string;
        value: unknown;
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
    }
  | {
      kind: typeof AgentEventKinds.ConfigReloaded;
      context: AgentEventContext;
      data: {
        configPath: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ConfigFailed;
      context: AgentEventContext;
      data: {
        configPath: string;
        message: string;
        details?: unknown;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelListSnapshot;
      context: AgentEventContext;
      data: {
        models: AgentModelProviderListItem[];
        defaultModelProviderId: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ProfileSnapshot;
      context: AgentEventContext;
      data: import("./AgentUserProfile.js").AgentUserProfile;
    };

type AgentEventSpec<TKind extends AgentEventKind, TData> = {
  layer: AgentEventLayer;
  phase: AgentEventPhase;
  kind: TKind;
  data: TData;
};

const EventSpecTable: {
  [K in AgentEventKind]: {
    layer: AgentEventLayer;
    phase: AgentEventPhase;
  };
} = {
  [AgentEventKinds.SessionCreated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionClosed]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionBusy]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionNotFound]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionListSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionHistorySnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.SessionTruncated]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Session,
  },
  [AgentEventKinds.RunStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.PromptRendered]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.PromptSummary]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
  },
  [AgentEventKinds.ModelStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelStreamOpened]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelDelta]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelCompleted]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.ModelStreamAborted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Model,
  },
  [AgentEventKinds.DecisionXmlProgress]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlReady]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlLimitReached]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlSummary]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionXmlDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionParsed]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.DecisionParsedDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
  },
  [AgentEventKinds.RetryPlanned]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Retry,
  },
  [AgentEventKinds.RetryDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Retry,
  },
  [AgentEventKinds.ToolCallsPlanned]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallStarted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallCompleted]: {
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolCallFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolResults]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.ToolResultsDetail]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Tool,
  },
  [AgentEventKinds.FinalAnswer]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.AskUser]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunCompleted]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RunCancelled]: {
    layer: AgentEventLayers.Terminal,
    phase: AgentEventPhases.Run,
  },
  [AgentEventKinds.RequestInvalid]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Request,
  },
  [AgentEventKinds.ConfigReloaded]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ConfigFailed]: {
    layer: AgentEventLayers.Error,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ModelListSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
  [AgentEventKinds.ProfileSnapshot]: {
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Config,
  },
};

export type AgentEventSink = (event: AgentDomainEvent) => void | Promise<void>;

export class AgentEventSequencer {
  private sequence = 0;

  next(): number {
    this.sequence += 1;
    return this.sequence;
  }
}

export function createEventDetailId(
  requestId: string | undefined,
  step: number | undefined,
  kind: AgentEventKind,
  suffix: string,
): string {
  return [
    requestId ?? "global",
    step ?? "na",
    kind,
    suffix,
  ].join(":");
}

export function toEventEnvelope(
  event: AgentDomainEvent,
  sequence: number,
): AgentEventEnvelope<AgentEventKind, unknown> {
  const spec = EventSpecTable[event.kind];
  const detailId = readDetailId(event.data);
  const context = event.context as AgentEventContext;
  const step = context.step;

  return {
    channel: AgentEventChannels.AgentEvent,
    kind: event.kind,
    layer: spec.layer,
    phase: spec.phase,
    sequence,
    timestamp: new Date().toISOString(),
    sessionId: context.sessionId,
    requestId: context.requestId,
    step,
    detailId,
    data: event.data,
  };
}

export async function emitAgentEvent(
  sink: AgentEventSink | undefined,
  event: AgentDomainEvent,
): Promise<void> {
  await sink?.(event);
}

export function withEventContext(
  event: AgentDomainEvent,
  context: Partial<AgentEventContext>,
): AgentDomainEvent {
  return {
    ...event,
    context: {
      ...event.context,
      ...context,
    },
  } as AgentDomainEvent;
}

function readDetailId(data: unknown): string | undefined {
  return data && typeof data === "object" && "detailId" in data
    ? String((data as { detailId?: unknown }).detailId ?? "")
    : undefined;
}

export function summarizePrompt(prompt: string): AgentEventSpec<typeof AgentEventKinds.PromptSummary, {
  chars: number;
  lines: number;
}> {
  return {
    kind: AgentEventKinds.PromptSummary,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
    data: {
      chars: prompt.length,
      lines: prompt.length === 0 ? 0 : prompt.split(/\r?\n/).length,
    },
  };
}

export function summarizeXmlDocument(xml: string, options: {
  sanitized: boolean;
  detailId: string;
}): AgentEventSpec<typeof AgentEventKinds.DecisionXmlSummary, {
  chars: number;
  lines: number;
  root?: string;
  sanitized: boolean;
  detailId: string;
}> {
  return {
    kind: AgentEventKinds.DecisionXmlSummary,
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
    data: {
      chars: xml.length,
      lines: xml.length === 0 ? 0 : xml.split(/\r?\n/).length,
      root: readXmlRootName(xml),
      sanitized: options.sanitized,
      detailId: options.detailId,
    },
  };
}
