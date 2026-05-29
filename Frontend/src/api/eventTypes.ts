// 协议类型——与后端 Source/AgentSystem/AgentEvent.ts 保持同步
// 保持手写，避免引入构建期类型同步链路；后端协议变更时手动更新。

export const EventLayers = {
  Progress: "progress",
  Snapshot: "snapshot",
  Terminal: "terminal",
  Error: "error",
} as const;
export type EventLayer = (typeof EventLayers)[keyof typeof EventLayers];

export const EventPhases = {
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
export type EventPhase = (typeof EventPhases)[keyof typeof EventPhases];

export const EventKinds = {
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
export type EventKind = (typeof EventKinds)[keyof typeof EventKinds];

export interface EventEnvelope<TKind extends string = EventKind, TData = unknown> {
  channel: "agent.event";
  kind: TKind;
  layer: EventLayer;
  phase: EventPhase;
  sequence: number;
  timestamp: string;
  sessionId?: string;
  requestId?: string;
  step?: number;
  detailId?: string;
  data: TData;
}

// --- 各 kind 的 data 形状（只列前端会读的字段） ---

export interface SessionSnapshotData {
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  turnCount: number;
  activeRequestId?: string;
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
}

export interface SessionListSnapshotData {
  sessions: SessionListItem[];
}

export interface SessionNotFoundData {
  sessionId: string;
  operation: "session.message" | "session.close" | "session.history";
  message: string;
}

export interface SessionBusyData {
  sessionId: string;
  activeRequestId: string;
  rejectedRequestId?: string;
  operation: "session.message" | "session.close";
  message: string;
}

export type ConversationEntryDto =
  | {
      id: string;
      requestId: string;
      timestamp: string;
      kind: "user.message";
      content: string;
      metadata?: ConversationEntryMetadata;
    }
  | {
      id: string;
      requestId: string;
      timestamp: string;
      kind: "assistant.decision";
      xml: string;
      metadata?: ConversationEntryMetadata;
    }
  | {
      id: string;
      requestId: string;
      timestamp: string;
      kind: "context.tool_results";
      xml: string;
      metadata?: ConversationEntryMetadata;
    };

export interface SessionHistorySnapshotData {
  sessionId: string;
  totalEntries: number;
  messageCount: number;
  entries: Array<{
    entry: ConversationEntryDto;
    visible?: { kind: string; text: string };
  }>;
}

export interface ModelProviderMetadata {
  id: string;
  title?: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

export interface ModelProviderListItem {
  id: string;
  title: string;
  icon?: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
}

export interface ModelListSnapshotData {
  models: ModelProviderListItem[];
  defaultModelProviderId: string;
}

export interface UserProfileData {
  name: string;
  avatarDataUrl: string | null;
  updatedAt: string;
}

export interface ModelUsageMetadata {
  source: "local_estimate";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ConversationEntryMetadata {
  run?: {
    modelProvider: ModelProviderMetadata;
    usage?: ModelUsageMetadata;
  };
}

export interface SessionTruncatedData {
  sessionId: string;
  fromRequestId: string;
  removedEntries: number;
}

export interface RunStartedData {
  input: string;
}

export interface PromptSummaryData {
  chars: number;
  lines: number;
}

export interface ModelDeltaData {
  text: string;
}

export interface ModelStartedData {
  model: string;
  provider?: ModelProviderMetadata;
}

export interface ModelStreamOpenedData {
  provider?: ModelProviderMetadata;
}

export interface ModelCompletedData {
  text: string;
  provider?: ModelProviderMetadata;
}

export interface DecisionXmlProgressData {
  state: string;
  xml: string;
  /** 后端已经把 CDATA 剥好、实体转义反过来的"用户可见文本"——流式逐步增长 */
  kind: "final_answer" | "ask_user" | "tool_calls" | "unknown";
  text: string;
}

export interface DecisionXmlSummaryData {
  chars: number;
  lines: number;
  root?: string;
  sanitized: boolean;
  detailId: string;
}

export interface DecisionParsedData {
  root: string;
  decisionKind: string;
  detailId: string;
}

export interface DecisionParsedDetailData {
  detailId: string;
  root: string;
  decisionKind: string;
  payload: unknown;
}

export interface ToolCallsPlannedData {
  toolCount: number;
  tools: string[];
}

export interface ToolCallStartedData {
  index: number;
  toolName: string;
  callId: string;
}

export interface ToolCallCompletedData {
  index: number;
  toolName: string;
  callId: string;
  preview?: string;
}

export interface ToolCallFailedData {
  index: number;
  toolName: string;
  callId: string;
  code?: string;
  message: string;
}

export interface ToolResultsDetailData {
  detailId: string;
  xml: string;
  value: unknown;
}

export interface FinalAnswerData {
  content: string;
}

export interface AskUserData {
  question: string;
  reasonCode?: string;
}

export interface RetryPlannedData {
  attempt: number;
  code: string;
  message: string;
  retryable: boolean;
  detailId: string;
}

export interface RunFailedData {
  message: string;
  code?: string;
  details?: unknown;
}

// --- 客户端 → 服务端 请求 ---

export type WsRequest =
  | { type: "session.create"; sessionId?: string }
  | { type: "session.message"; sessionId: string; requestId?: string; modelProviderId?: string; input: string }
  | { type: "session.close"; sessionId: string }
  | { type: "session.cancel"; sessionId: string }
  | { type: "session.truncate_from"; sessionId: string; requestId: string }
  | { type: "session.list" }
  | { type: "session.history"; sessionId: string }
  | { type: "session.rename"; sessionId: string; title: string }
  | { type: "model.list" }
  | { type: "profile.get" }
  | { type: "profile.update"; profile: Pick<UserProfileData, "name" | "avatarDataUrl"> };
