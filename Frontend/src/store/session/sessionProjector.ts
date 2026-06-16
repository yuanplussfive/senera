import { DEFAULT_SESSION_TITLE } from "./defaults";
import { normalizeUserProfile } from "./userProfile";
import {
  DecisionXmlRoots,
  EventKinds,
  type ActionPlannedData,
  type ActionPlannerStageCompletedData,
  type ActionPlannerStageFailedData,
  type ActionPlannerStageName,
  type ActionPlannerStageStartedData,
  type EventEnvelope,
  type AskUserData,
  type ConversationEntryDto,
  type DecisionParsedData,
  type DecisionParsedDetailData,
  type DecisionXmlProgressData,
  type DecisionXmlSummaryData,
  type FinalAnswerData,
  type ModelDeltaData,
  type ModelListSnapshotData,
  type ModelStartedData,
  type PluginConfigSnapshotData,
  type PromptSummaryData,
  type RetryPlannedData,
  type RunFailedData,
  type SessionHistoryCompletedData,
  type SessionHistoryEntryData,
  type SessionHistoryChunkData,
  type SessionRunHistoryChunkData,
  type RunStartedData,
  type SessionHistoryStartedData,
  type SessionBusyData,
  type SessionHistorySnapshotData,
  type SessionListItem,
  type SessionListSnapshotData,
  type SessionNotFoundData,
  type SessionSnapshotData,
  type SessionTruncatedData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
  type ToolResultsDetailData,
  type SessionHistoryStepsData,
  type StepTraceDto,
  type UserProfileData,
} from "../../api/eventTypes";
import type {
  ChatMessage,
  RunRecord,
  SessionRecord,
  StoreState,
  TimelineStep,
} from "./types";

export { normalizeUserProfile } from "./userProfile";

// =========================
// 工具函数
// =========================
const nowIso = (): string => new Date().toISOString();

export function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 把后端行动/决策枚举翻译成中文用户语。 */
export function friendlyDecisionKind(decisionKind: string): string {
  switch (decisionKind) {
    case "answer":
    case "FinalAnswer":
      return "生成回复";
    case "ask_user":
    case "AskUser":
      return "向用户提问";
    case "discover_tools":
      return "发现工具";
    case "use_tools":
    case "ToolCalls":
      return "调用工具";
    default:
      return decisionKind;
  }
}

function summarizeActionPlan(data: ActionPlannedData): string {
  if (data.status === "fallback") {
    return data.reason
      ? `规划失败，已回退动态工具检索 · ${friendlyActionPlanFallbackReason(data.reason)}`
      : "规划失败，已回退动态工具检索";
  }

  const intent = data.intent ? truncate(data.intent, 96) : "";
  const progress = data.progressAssessment ? truncate(data.progressAssessment, 96) : "";
  const nextGoal = data.nextStepGoal ? truncate(data.nextStepGoal, 96) : "";
  const toolSummary = data.preferredTools.length > 0
    ? `${data.preferredTools.length} 个候选工具`
    : "";
  const stateSummary = data.executionState
    ? `${data.executionState.totalToolCalls} 次工具 · ${data.executionState.totalEvidence} 条证据`
    : "";
  return [progress, nextGoal, intent, toolSummary, stateSummary]
    .filter(Boolean)
    .join(" · ");
}

function friendlyActionPlanFallbackReason(reason: string): string {
  const code = reason.split(":")[0];
  switch (code) {
    case "disabled":
      return "未启用";
    case "action_planner_http_error":
      return "规划模型请求失败";
    case "action_planner_timeout":
      return "规划模型超时";
    case "action_planner_aborted":
      return "规划已取消";
    case "action_planner_incomplete_output":
      return "规划输出不完整";
    case "action_planner_invalid_structured_output":
    case "action_planner_invalid_decision":
      return "规划输出无效";
    default:
      return truncate(reason, 80);
  }
}

function readExpectedOutputMode(data: ActionPlannedData): RunRecord["expectedOutputMode"] {
  return data.expectedOutputMode === "tool_call_xml" || data.expectedOutputMode === "final_text"
    ? data.expectedOutputMode
    : "unknown";
}

function plannerStageBaseTitle(stage: ActionPlannerStageName): string {
  switch (stage) {
    case "selectAction":
      return "选择行动";
    case "buildActionPayload":
      return "构建行动参数";
    default:
      return stage;
  }
}

function plannerStageTitle(
  stage: ActionPlannerStageName,
  selectedAction?: string,
): string {
  const base = plannerStageBaseTitle(stage);
  return stage === "buildActionPayload" && selectedAction
    ? `${base} · ${friendlyDecisionKind(selectedAction)}`
    : base;
}

function plannerStageStepId(
  requestId: string,
  step: number | undefined,
  stage: ActionPlannerStageName,
): string {
  return `${requestId}-action-planner-${step ?? 0}-${stage}`;
}

function hasPlannerStageForStep(run: RunRecord, step: number | undefined): boolean {
  const prefix = `${run.requestId}-action-planner-${step ?? 0}-`;
  return run.steps.some((entry) => entry.id.startsWith(prefix));
}

function currentRun(session: SessionRecord, requestId?: string): RunRecord | undefined {
  if (!requestId) return session.runs[session.runs.length - 1];
  return session.runs.find((r) => r.requestId === requestId);
}

function syncSessionCountsFromLoadedMessages(session: SessionRecord): void {
  session.messageCount = session.messages.length;
}

export function bumpSessionMessageCount(session: SessionRecord): void {
  session.messageCount = Math.max(session.messageCount, session.messages.length);
}

type ToolCallStreamClassification =
  | "tool_prefix"
  | "not_tool";

function classifyToolCallStream(text: string): ToolCallStreamClassification {
  const body = text.trimStart();
  if (!body.startsWith("<")) return "not_tool";

  const expectedRoot = `<${DecisionXmlRoots.ToolCalls}`.toLowerCase();
  const comparable = body.slice(0, expectedRoot.length).toLowerCase();
  const isPrefixCandidate = comparable.length < expectedRoot.length
    ? expectedRoot.startsWith(comparable)
    : comparable === expectedRoot && isXmlNameBoundary(body[expectedRoot.length]);

  return isPrefixCandidate ? "tool_prefix" : "not_tool";
}

function isXmlNameBoundary(char: string | undefined): boolean {
  return char === undefined || char === ">" || char === "/" || /\s/.test(char);
}

function projectStreamingVisibility(run: RunRecord): void {
  if (run.expectedOutputMode === "tool_call_xml") {
    run.decisionMode = "tool_candidate";
    run.visibleText = "";
    run.visibleKind = "tool_calls";
    return;
  }

  if (run.expectedOutputMode === "final_text") {
    run.decisionMode = "final_text";
    run.visibleText = run.streamingRaw;
    run.visibleKind = "final_answer";
    return;
  }

  if (run.decisionMode === "final_text") {
    run.visibleText = run.streamingRaw;
    run.visibleKind = "final_answer";
    return;
  }

  if (classifyToolCallStream(run.streamingRaw) === "tool_prefix") {
    run.decisionMode = "tool_candidate";
    run.visibleText = "";
    run.visibleKind = "unknown";
    return;
  }

  run.decisionMode = "final_text";
  run.visibleText = run.streamingRaw;
  run.visibleKind = "final_answer";
}

export function createRunRecord(input: {
  requestId: string;
  startedAt: string;
  input: string;
}): RunRecord {
  return {
    requestId: input.requestId,
    revision: 0,
    startedAt: input.startedAt,
    status: "running",
    input: input.input,
    steps: [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
  };
}

function touchRun(run: RunRecord): void {
  run.revision = (run.revision ?? 0) + 1;
}

function ensureSession(state: StoreState, sessionId: string): SessionRecord {
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = {
      sessionId,
      title: DEFAULT_SESSION_TITLE,
      status: "ready",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      entryCount: 0,
      messageCount: 0,
      messages: [],
      runs: [],
    };
    if (!state.sessionOrder.includes(sessionId)) {
      state.sessionOrder.unshift(sessionId);
    }
  }
  return state.sessions[sessionId];
}

function upsertStep(run: RunRecord, step: TimelineStep): void {
  const idx = run.steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) {
    run.steps[idx] = { ...run.steps[idx], ...step };
  } else {
    run.steps.push(step);
  }
  touchRun(run);
}

/** 把持久化的精简档 StepTrace 还原成与实时态一致的 TimelineStep（id 约定对齐 ingest case） */
function stepTraceToTimelineStep(trace: StepTraceDto, fallbackTime: string): TimelineStep {
  const startedAt = trace.startedAt ?? fallbackTime;
  const endedAt = trace.endedAt ?? startedAt;
  if (trace.kind === "tool") {
    return {
      id: trace.callId ? `tool-${trace.callId}` : `tool-${trace.step}-${trace.seq}`,
      kind: "tool",
      title: trace.status === "failed" ? `调用 ${trace.toolName ?? "工具"} 失败` : `调用 ${trace.toolName ?? "工具"}`,
      status: trace.status,
      startedAt,
      endedAt,
      toolName: trace.toolName,
      callId: trace.callId,
      toolArgs: trace.toolArgs,
      toolPreview: trace.toolPreview,
      toolResult: trace.toolResult,
      toolErrorMessage: trace.toolErrorMessage,
    };
  }
  if (trace.kind === "answer") {
    return {
      id: `${trace.step}-answer-${trace.seq}`,
      kind: "answer",
      title: trace.title ?? "生成回复",
      status: trace.status,
      startedAt,
      endedAt,
    };
  }
  if (trace.kind === "retry") {
    return {
      id: `retry-${trace.step}-${trace.seq}`,
      kind: "retry",
      title: "重试",
      status: trace.status,
      startedAt,
      endedAt,
      retryCode: trace.retryCode,
      errorMessage: trace.errorMessage,
    };
  }
  // decision
  return {
    id: `decision-${trace.step}-${trace.seq}`,
    kind: "decision",
    title: "确定行动",
    description: trace.decisionKind ? friendlyDecisionKind(trace.decisionKind) : undefined,
    status: trace.status,
    startedAt,
    endedAt,
    decisionKind: trace.decisionKind,
  };
}

/** 从历史 step 轨迹重建一个已完成的 RunRecord */
function rebuildRunFromHistory(run: SessionHistoryStepsData["runs"][number]): RunRecord {
  const record: RunRecord = {
    requestId: run.requestId,
    revision: 0,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    input: run.input,
    steps: run.traces.map((trace) => stepTraceToTimelineStep(trace, run.startedAt)),
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
    modelProvider: run.modelProvider,
  };
  record.revision = record.steps.length;
  return record;
}

// =========================
// reducer：把 36 种事件投影到状态
// =========================

export function applyEvent(state: StoreState, env: EventEnvelope): void {
  const sessionId = env.sessionId;

  if (
    sessionId &&
    state.pendingDeletedSessionIds[sessionId] &&
    !isPendingDeleteResolutionEvent(env.kind)
  ) {
    return;
  }

  switch (env.kind) {
    case EventKinds.ModelListSnapshot: {
      const data = env.data as ModelListSnapshotData;
      state.modelProviders = data.models;
      const selectedId = state.selectedModelProviderId;
      const selectedStillExists = selectedId
        ? data.models.some((model) => model.id === selectedId)
        : false;
      state.selectedModelProviderId = selectedStillExists
        ? selectedId
        : data.defaultModelProviderId;
      return;
    }

    case EventKinds.ProfileSnapshot: {
      if (state.userProfile.syncState === "pending") return;
      state.userProfile = normalizeUserProfile(env.data as UserProfileData);
      return;
    }

    case EventKinds.PluginConfigSnapshot: {
      const data = env.data as PluginConfigSnapshotData;
      state.pluginConfigs = data.plugins;
      return;
    }

    case EventKinds.SessionCreated:
    case EventKinds.SessionSnapshot: {
      if (!sessionId) return;
      const data = env.data as SessionSnapshotData;
      delete state.pendingCreatedSessionIds[sessionId];
      if (state.pendingDeletedSessionIds[sessionId]) return;
      const existing = state.sessions[sessionId];
      if (existing) {
        existing.status = "ready";
        existing.updatedAt = data.updatedAt ?? nowIso();
        existing.entryCount = data.entryCount;
        existing.messageCount = data.messageCount;
        existing.activeRequestId = data.activeRequestId;
      } else {
        state.sessions[sessionId] = {
          sessionId,
          title: DEFAULT_SESSION_TITLE,
          status: "ready",
          createdAt: data.createdAt ?? nowIso(),
          updatedAt: data.updatedAt ?? nowIso(),
          entryCount: data.entryCount,
          messageCount: data.messageCount,
          messages: [],
          runs: [],
          activeRequestId: data.activeRequestId,
        };
        if (!state.sessionOrder.includes(sessionId)) {
          state.sessionOrder.unshift(sessionId);
        }
      }
      delete state.missingOnServerIds[sessionId];
      if (!state.activeSessionId) state.activeSessionId = sessionId;
      return;
    }

    case EventKinds.SessionClosed: {
      if (!sessionId) return;
      delete state.pendingDeletedSessionIds[sessionId];
      delete state.pendingCreatedSessionIds[sessionId];
      if (!state.sessions[sessionId]) return;
      delete state.sessions[sessionId];
      state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
      delete state.historyLoadedIds[sessionId];
      delete state.historyLoadingIds[sessionId];
      delete state.viewedRunIdBySession[sessionId];
      delete state.missingOnServerIds[sessionId];
      if (state.activeSessionId === sessionId) {
        state.activeSessionId = state.sessionOrder[0] ?? null;
      }
      if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
        state.activeSessionId = state.sessionOrder[0] ?? null;
      }
      return;
    }

    case EventKinds.RunStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const data = env.data as RunStartedData;
      let run = currentRun(session, env.requestId);
      if (!run) {
        run = createRunRecord({
          requestId: env.requestId ?? "unknown",
          startedAt: env.timestamp,
          input: data.input,
        });
        session.runs.push(run);
      } else {
        run.status = "running";
      }
      upsertStep(run, {
        id: `${run.requestId}-understand`,
        kind: "understand",
        title: "理解用户问题",
        description: truncate(data.input, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      session.activeRequestId = run.requestId;
      session.updatedAt = env.timestamp;
      delete state.viewedRunIdBySession[sessionId];
      return;
    }

    case EventKinds.RunCompleted: {
      if (!sessionId) return;
      const session = state.sessions[sessionId];
      if (!session) return;
      const run = currentRun(session, env.requestId);
      if (!run) return;
      run.status = "completed";
      run.endedAt = env.timestamp;
      touchRun(run);
      session.activeRequestId = undefined;
      session.updatedAt = env.timestamp;
      return;
    }

    case EventKinds.RunFailed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const data = env.data as RunFailedData;
      const run = currentRun(session, env.requestId);
      if (!run && state.historyLoadingIds[sessionId]) {
        session.messages = [];
        session.runs = [];
        state.historyLoadingIds[sessionId] = false;
        state.historyFailedIds[sessionId] = true;
        delete state.historyReplayBuffers[sessionId];
        delete state.historyStepBuffers[sessionId];
        return;
      }
      if (run) {
        run.status = "failed";
        run.endedAt = env.timestamp;
        upsertStep(run, {
          id: `${run.requestId}-error`,
          kind: "error",
          title: "运行失败",
          description: data.message,
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          errorMessage: data.message,
        });
      }
      session.messages.push({
        id: `${env.requestId ?? "run"}-error`,
        role: "system",
        content: data.message,
        createdAt: env.timestamp,
        kind: "Error",
        requestId: env.requestId,
      });
      bumpSessionMessageCount(session);
      session.activeRequestId = undefined;
      return;
    }

    case EventKinds.SessionBusy: {
      if (!sessionId) return;
      const session = state.sessions[sessionId];
      if (!session) return;
      const data = env.data as SessionBusyData;
      const rejectedRequestId = data.rejectedRequestId || env.requestId;
      if (!rejectedRequestId || rejectedRequestId === data.activeRequestId) return;
      const run = session.runs.find((item) => item.requestId === rejectedRequestId);
      if (run) {
        run.status = "failed";
        run.endedAt = env.timestamp;
        upsertStep(run, {
          id: `${run.requestId}-busy`,
          kind: "error",
          title: "会话正忙",
          description: data.message,
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          errorMessage: data.message,
        });
      }
      if (session.activeRequestId === rejectedRequestId) {
        session.activeRequestId = data.activeRequestId || undefined;
      }
      return;
    }

    case EventKinds.RunCancelled: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (run) {
        run.status = "cancelled";
        run.endedAt = env.timestamp;
        run.streamingRaw = "";
        run.xmlPreview = "";
        run.visibleText = "";
        run.decisionMode = "none";
        upsertStep(run, {
          id: `${run.requestId}-cancelled`,
          kind: "error",
          title: "已取消",
          description: "用户中断了本次运行。",
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
        });
      }
      session.activeRequestId = undefined;
      session.updatedAt = env.timestamp;
      return;
    }

    case EventKinds.PromptSummary: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as PromptSummaryData;
      upsertStep(run, {
        id: `${run.requestId}-prompt-${env.step ?? 0}`,
        kind: "prompt",
        title: `渲染 Prompt`,
        description: `第 ${env.step ?? 0} 步`,
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        promptChars: data.chars,
        promptLines: data.lines,
        promptTokenCount: data.tokenCount,
      });
      return;
    }

    case EventKinds.ActionPlannerStageStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ActionPlannerStageStartedData;
      upsertStep(run, {
        id: plannerStageStepId(run.requestId, env.step, data.stage),
        kind: "decision",
        title: plannerStageTitle(data.stage),
        status: "running",
        startedAt: env.timestamp,
        decisionKind: data.stage,
      });
      return;
    }

    case EventKinds.ActionPlannerStageCompleted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ActionPlannerStageCompletedData;
      upsertStep(run, {
        id: plannerStageStepId(run.requestId, env.step, data.stage),
        kind: "decision",
        title: plannerStageTitle(data.stage, data.selectedAction),
        status: "done",
        startedAt: run.steps.find((step) =>
          step.id === plannerStageStepId(run.requestId, env.step, data.stage))?.startedAt ?? env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.selectedAction,
        detailJson: data,
      });
      return;
    }

    case EventKinds.ActionPlannerStageFailed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ActionPlannerStageFailedData;
      upsertStep(run, {
        id: plannerStageStepId(run.requestId, env.step, data.stage),
        kind: "decision",
        title: plannerStageTitle(data.stage),
        description: data.message,
        status: "failed",
        startedAt: run.steps.find((step) =>
          step.id === plannerStageStepId(run.requestId, env.step, data.stage))?.startedAt ?? env.timestamp,
        endedAt: env.timestamp,
        errorMessage: data.message,
        detailJson: data,
      });
      return;
    }

    case EventKinds.ActionPlanned: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ActionPlannedData;
      const planned = data.status === "planned";
      run.expectedOutputMode = planned
        ? readExpectedOutputMode(data)
        : "unknown";
      if (run.expectedOutputMode === "tool_call_xml") {
        run.decisionMode = "tool_candidate";
        run.visibleText = "";
        run.visibleKind = "tool_calls";
      }
      if (hasPlannerStageForStep(run, env.step)) {
        return;
      }
      upsertStep(run, {
        id: `${run.requestId}-action-plan-${env.step ?? 0}`,
        kind: "decision",
        title: planned
          ? `规划行动 · ${friendlyDecisionKind(data.action ?? "")}`
          : "规划行动 · 回退",
        description: summarizeActionPlan(data),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.action,
        detailJson: data,
      });
      return;
    }

    case EventKinds.ModelStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ModelStartedData;
      const modelName = data.provider?.title ?? data.model;
      run.modelProvider = data.provider;
      run.streamingRaw = "";
      run.xmlPreview = "";
      run.visibleText = "";
      run.visibleKind = run.expectedOutputMode === "tool_call_xml" ? "tool_calls" : "unknown";
      run.decisionMode = run.expectedOutputMode === "tool_call_xml" ? "tool_candidate" : "none";
      upsertStep(run, {
        id: `${run.requestId}-model-${env.step ?? 0}`,
        kind: "model",
        title: `调用模型`,
        description: `第 ${env.step ?? 0} 步`,
        status: "running",
        startedAt: env.timestamp,
        modelName,
      });
      return;
    }

    case EventKinds.ModelDelta: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ModelDeltaData;
      run.streamingRaw += data.text;
      projectStreamingVisibility(run);
      touchRun(run);
      return;
    }

    case EventKinds.ModelCompleted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const stepId = `${run.requestId}-model-${env.step ?? 0}`;
      const step = run.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        touchRun(run);
      }
      return;
    }

    case EventKinds.DecisionXmlProgress: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionXmlProgressData;
      run.xmlPreview = data.xml;
      if (run.expectedOutputMode === "tool_call_xml" || data.kind === "tool_calls") {
        run.decisionMode = "tool_candidate";
        run.visibleText = "";
        run.visibleKind = "tool_calls";
        touchRun(run);
        return;
      }
      if (
        run.decisionMode === "tool_candidate" &&
        classifyToolCallStream(run.streamingRaw) === "tool_prefix"
      ) {
        run.visibleText = "";
        run.visibleKind = "unknown";
        touchRun(run);
        return;
      }
      run.decisionMode = "none";
      run.visibleText = data.text || run.streamingRaw;
      run.visibleKind = data.kind;
      touchRun(run);
      return;
    }

    case EventKinds.DecisionXmlSummary: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionXmlSummaryData;
      upsertStep(run, {
        id: `${run.requestId}-decision-xml-${env.step ?? 0}`,
        kind: "decision",
        title: `行动决策`,
        description: `${data.root ?? "?"} · ${data.chars} 字符${data.sanitized ? " · 已清洗" : ""}`,
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        xmlRoot: data.root,
      });
      return;
    }

    case EventKinds.DecisionParsed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionParsedData;
      upsertStep(run, {
        id: `${run.requestId}-decision-${env.step ?? 0}`,
        kind: "decision",
        title: "确定行动",
        description: `${friendlyDecisionKind(data.decisionKind)}`,
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.decisionKind,
        xmlRoot: data.root,
      });
      return;
    }

    case EventKinds.DecisionParsedDetail: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionParsedDetailData;
      if (data.decisionKind === "ToolCalls" && data.payload && typeof data.payload === "object") {
        const payload = data.payload as { tool_calls?: Array<{ name?: string; arguments?: unknown }> };
        const calls = payload.tool_calls ?? [];
        for (const call of calls) {
          if (call.name) {
            run.pendingToolArgsByName[call.name] = call.arguments;
            touchRun(run);
          }
        }
      }
      const stepId = `${run.requestId}-decision-${env.step ?? 0}`;
      const step = run.steps.find((s) => s.id === stepId);
      if (step) {
        step.detailJson = data.payload;
        touchRun(run);
      }
      return;
    }

    case EventKinds.ToolCallsPlanned: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallsPlannedData;
      upsertStep(run, {
        id: `${run.requestId}-tool-plan-${env.step ?? 0}`,
        kind: "tool",
        title: `工具计划 · ${data.toolCount} 个`,
        description: data.tools.join(", "),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      return;
    }

    case EventKinds.ToolCallStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallStartedData;
      upsertStep(run, {
        id: `tool-${data.callId}`,
        kind: "tool",
        title: `调用 ${data.toolName}`,
        status: "running",
        startedAt: env.timestamp,
        toolName: data.toolName,
        callId: data.callId,
        toolArgs: run.pendingToolArgsByName[data.toolName],
      });
      return;
    }

    case EventKinds.ToolCallCompleted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallCompletedData;
      const step = run.steps.find((s) => s.id === `tool-${data.callId}`);
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        step.toolPreview = data.preview;
        touchRun(run);
      }
      return;
    }

    case EventKinds.ToolCallFailed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallFailedData;
      const step = run.steps.find((s) => s.id === `tool-${data.callId}`);
      if (step) {
        step.status = "failed";
        step.endedAt = env.timestamp;
        step.toolErrorMessage = data.message;
        touchRun(run);
      } else {
        upsertStep(run, {
          id: `tool-${data.callId}`,
          kind: "tool",
          title: `调用 ${data.toolName} 失败`,
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          toolName: data.toolName,
          callId: data.callId,
          toolErrorMessage: data.message,
        });
      }
      return;
    }

    case EventKinds.ToolResultsDetail: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolResultsDetailData;
      if (Array.isArray(data.value)) {
        for (const entry of data.value) {
          const callId = (entry as { callId?: string })?.callId;
          if (!callId) continue;
          const step = run.steps.find((s) => s.id === `tool-${callId}`);
          if (step) {
            step.toolResult = entry;
            touchRun(run);
          }
        }
      }
      return;
    }

    case EventKinds.RetryPlanned: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as RetryPlannedData;
      upsertStep(run, {
        id: `${run.requestId}-retry-${data.attempt}`,
        kind: "retry",
        title: `重试 · 第 ${data.attempt} 次`,
        description: `${data.code} · ${data.message}`,
        status: data.retryable ? "done" : "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        retryAttempt: data.attempt,
        retryCode: data.code,
      });
      return;
    }

    case EventKinds.FinalAnswer: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      const data = env.data as FinalAnswerData;
      session.messages.push({
        id: `${env.requestId ?? "final"}-answer`,
        role: "assistant",
        content: data.content,
        createdAt: env.timestamp,
        kind: "FinalAnswer",
        requestId: env.requestId,
        metadata: run?.modelProvider
          ? { run: { modelProvider: run.modelProvider } }
          : undefined,
      });
      bumpSessionMessageCount(session);
      if (run) {
        upsertStep(run, {
          id: `${run.requestId}-answer`,
          kind: "answer",
          title: "生成回复",
          description: truncate(data.content, 60),
          status: "done",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
        });
        run.streamingRaw = "";
        run.xmlPreview = "";
        run.visibleText = "";
        run.decisionMode = "none";
      }
      session.updatedAt = env.timestamp;
      // 这个会话挪到列表顶部
      state.sessionOrder = [sessionId, ...state.sessionOrder.filter((id) => id !== sessionId)];
      return;
    }

    case EventKinds.AskUser: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      const data = env.data as AskUserData;
      session.messages.push({
        id: `${env.requestId ?? "ask"}-ask`,
        role: "assistant",
        content: data.question,
        createdAt: env.timestamp,
        kind: "AskUser",
        requestId: env.requestId,
        metadata: run?.modelProvider
          ? { run: { modelProvider: run.modelProvider } }
          : undefined,
      });
      bumpSessionMessageCount(session);
      if (run) {
        upsertStep(run, {
          id: `${run.requestId}-answer`,
          kind: "answer",
          title: "向用户提问",
          description: truncate(data.question, 60),
          status: "done",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
        });
        run.streamingRaw = "";
        run.xmlPreview = "";
        run.visibleText = "";
        run.decisionMode = "none";
      }
      return;
    }

    case EventKinds.SessionListSnapshot: {
      const data = env.data as SessionListSnapshotData;
      ingestSessionList(state, data.sessions);
      return;
    }

    case EventKinds.SessionHistorySnapshot: {
      if (!sessionId) return;
      const data = env.data as SessionHistorySnapshotData;
      const session = state.sessions[sessionId];
      if (!session) return;
      session.messages = data.entries
        .map((item) => projectEntryToMessage(item.entry, item.visible))
        .filter((message): message is ChatMessage => Boolean(message));
      session.entryCount = data.totalEntries;
      session.messageCount = data.messageCount;
      state.historyLoadingIds[sessionId] = false;
      state.historyLoadedIds[sessionId] = true;
      delete state.historyReplayBuffers[sessionId];
      delete state.historyStepBuffers[sessionId];
      delete state.historyFailedIds[sessionId];
      delete state.missingOnServerIds[sessionId];
      return;
    }

    case EventKinds.SessionHistoryStarted: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryStartedData;
      const session = state.sessions[sessionId];
      if (!session) return;
      session.messages = [];
      session.runs = [];
      session.entryCount = data.totalEntries;
      session.messageCount = data.messageCount;
      state.historyReplayBuffers[sessionId] = [];
      state.historyStepBuffers[sessionId] = [];
      state.historyLoadingIds[sessionId] = true;
      delete state.historyLoadedIds[sessionId];
      delete state.historyFailedIds[sessionId];
      delete state.missingOnServerIds[sessionId];
      return;
    }

    case EventKinds.SessionHistoryChunk: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryChunkData;
      const session = state.sessions[sessionId];
      if (!session) return;
      const buffer = state.historyReplayBuffers[sessionId];
      if (!state.historyLoadingIds[sessionId] || !buffer) return;
      buffer.push(...data.entries);
      return;
    }

    case EventKinds.SessionHistoryEntry: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryEntryData;
      const session = state.sessions[sessionId];
      if (!session) return;
      const buffer = state.historyReplayBuffers[sessionId];
      if (!state.historyLoadingIds[sessionId] || !buffer) return;
      buffer.push({
        entry: data.entry,
        visible: data.visible,
      });
      return;
    }

    case EventKinds.SessionHistorySteps: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryStepsData;
      const session = state.sessions[sessionId];
      if (!session) return;
      if (!state.historyLoadingIds[sessionId]) return;
      state.historyStepBuffers[sessionId] = data.runs;
      return;
    }

    case EventKinds.SessionRunHistoryChunk: {
      if (!sessionId) return;
      const data = env.data as SessionRunHistoryChunkData;
      if (data.sessionId && data.sessionId !== sessionId) return;
      const session = state.sessions[sessionId];
      if (!session) return;
      if (!state.historyLoadingIds[sessionId]) return;
      for (const event of data.events) {
        applyEvent(state, {
          ...event,
          sessionId: event.sessionId ?? sessionId,
        });
      }
      return;
    }

    case EventKinds.SessionHistoryCompleted: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryCompletedData;
      if (data.sessionId && data.sessionId !== sessionId) return;
      const session = state.sessions[sessionId];
      if (!session) return;
      const buffer = state.historyReplayBuffers[sessionId];
      if (!state.historyLoadingIds[sessionId] || !buffer) return;
      session.messages = buffer
        .map((item) => projectEntryToMessage(item.entry, item.visible))
        .filter((message): message is ChatMessage => Boolean(message));
      // 用回放的 step 轨迹重建 session.runs（替代此前写死的 []）
      const stepRuns = state.historyStepBuffers[sessionId] ?? [];
      if (stepRuns.length > 0) {
        session.runs = stepRuns.map((run) => rebuildRunFromHistory(run));
      }
      state.historyLoadingIds[sessionId] = false;
      state.historyLoadedIds[sessionId] = true;
      delete state.historyReplayBuffers[sessionId];
      delete state.historyStepBuffers[sessionId];
      delete state.historyFailedIds[sessionId];
      delete state.missingOnServerIds[sessionId];
      syncSessionCountsFromLoadedMessages(session);
      return;
    }

    case EventKinds.SessionNotFound: {
      if (!sessionId) return;
      const data = env.data as SessionNotFoundData;
      state.historyLoadingIds[sessionId] = false;
      delete state.historyReplayBuffers[sessionId];
      delete state.historyStepBuffers[sessionId];
      delete state.historyFailedIds[sessionId];
      if (data.operation === "session.close") {
        delete state.pendingDeletedSessionIds[sessionId];
        delete state.pendingCreatedSessionIds[sessionId];
        delete state.sessions[sessionId];
        state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
        if (state.activeSessionId === sessionId) {
          state.activeSessionId = state.sessionOrder[0] ?? null;
        }
        return;
      }
      if (data.operation === "session.history") {
        state.missingOnServerIds[sessionId] = true;
        delete state.historyLoadedIds[sessionId];
        if (state.sessions[sessionId]) {
          state.sessions[sessionId].messages = [];
          state.sessions[sessionId].runs = [];
          state.sessions[sessionId].entryCount = 0;
          state.sessions[sessionId].messageCount = 0;
        }
        if (state.activeSessionId === sessionId) {
          state.activeSessionId = readFirstAvailableSessionId(state, sessionId);
        }
      }
      return;
    }

    case EventKinds.SessionTruncated: {
      if (!sessionId) return;
      const data = env.data as SessionTruncatedData;
      const session = state.sessions[sessionId];
      if (!session) return;
      // 删除从该 requestId 起的所有消息（含其本身）
      const idx = session.messages.findIndex((m) => m.requestId === data.fromRequestId);
      if (idx >= 0) {
        session.messages = session.messages.slice(0, idx);
        syncSessionCountsFromLoadedMessages(session);
      }
      // 同样清掉对应的 runs
      const runIdx = session.runs.findIndex((r) => r.requestId === data.fromRequestId);
      if (runIdx >= 0) {
        session.runs = session.runs.slice(0, runIdx);
      }
      const viewedRunId = state.viewedRunIdBySession[sessionId];
      if (viewedRunId && !session.runs.some((run) => run.requestId === viewedRunId)) {
        delete state.viewedRunIdBySession[sessionId];
      }
      session.updatedAt = env.timestamp;
      return;
    }

    default:
      return;
  }
}

function isPendingDeleteResolutionEvent(kind: string): boolean {
  return kind === EventKinds.SessionClosed || kind === EventKinds.SessionNotFound;
}

// ---- 历史回放：把 conversation entry 投影成可见 message ----

function projectEntryToMessage(
  entry: ConversationEntryDto,
  visible?: { kind: string; text: string },
): ChatMessage | null {
  if (entry.kind === "user.message") {
    return {
      id: `${entry.requestId}-user`,
      role: "user",
      content: entry.content,
      createdAt: entry.timestamp,
      requestId: entry.requestId,
      attachments: entry.attachments,
      metadata: entry.metadata,
    };
  }
  if (entry.kind === "assistant.decision") {
    if (!visible || !visible.text) return null;
    const isAsk = visible.kind === "ask_user";
    return {
      id: `${entry.requestId}-${isAsk ? "ask" : "answer"}`,
      role: "assistant",
      content: visible.text,
      createdAt: entry.timestamp,
      kind: isAsk ? "AskUser" : "FinalAnswer",
      requestId: entry.requestId,
      metadata: entry.metadata,
    };
  }
  return null;
}

// ---- session.list.snapshot：合并后端目录到本地 ----

function ingestSessionList(state: StoreState, items: SessionListItem[]): void {
  const serverIds = new Set(items.map((item) => item.sessionId));

  for (const pendingId of Object.keys(state.pendingDeletedSessionIds)) {
    if (serverIds.has(pendingId)) continue;
    delete state.pendingDeletedSessionIds[pendingId];
    deleteSessionRuntimeState(state, pendingId);
  }

  const visibleItems = items.filter((item) => !state.pendingDeletedSessionIds[item.sessionId]);
  const visibleServerIds = new Set<string>();
  for (const item of visibleItems) {
    visibleServerIds.add(item.sessionId);
    delete state.pendingCreatedSessionIds[item.sessionId];
    const existing = state.sessions[item.sessionId];
    if (existing) {
      existing.title = item.title;
      existing.status = item.status === "running" ? "ready" : (item.status as SessionRecord["status"]);
      existing.updatedAt = item.updatedAt;
      existing.createdAt = item.createdAt;
      existing.entryCount = item.entryCount;
      existing.messageCount = item.messageCount;
    } else {
      state.sessions[item.sessionId] = {
        sessionId: item.sessionId,
        title: item.title,
        status: "ready",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        entryCount: item.entryCount,
        messageCount: item.messageCount,
        messages: [],
        runs: [],
      };
    }
    delete state.missingOnServerIds[item.sessionId];
  }

  // 重新排序：后端列表已按 updatedAt DESC 排序
  const serverOrdered = visibleItems.map((i) => i.sessionId);
  const pendingCreatedOrdered = state.sessionOrder.filter(
    (id) => state.pendingCreatedSessionIds[id] && state.sessions[id] && !visibleServerIds.has(id),
  );
  state.sessionOrder = mergeSessionOrder(pendingCreatedOrdered, serverOrdered);
  const fallbackActiveSessionId = readPreferredActiveSessionId(state, visibleItems);

  if (
    state.activeSessionId &&
    !state.sessionOrder.includes(state.activeSessionId) &&
    state.sessionOrder.length > 0
  ) {
    state.activeSessionId = fallbackActiveSessionId;
  } else if (
    state.activeSessionId &&
    !state.sessionOrder.includes(state.activeSessionId) &&
    state.sessionOrder.length === 0
  ) {
    state.activeSessionId = null;
  } else if (!state.activeSessionId && state.sessionOrder.length > 0) {
    state.activeSessionId = fallbackActiveSessionId;
  }

  for (const localId of Object.keys(state.sessions)) {
    const shouldKeep =
      visibleServerIds.has(localId) ||
      Boolean(state.pendingCreatedSessionIds[localId]) ||
      Boolean(state.pendingDeletedSessionIds[localId]);
    if (!shouldKeep) {
      deleteSessionRuntimeState(state, localId);
    }
  }
}

function readPreferredActiveSessionId(
  state: StoreState,
  visibleItems: readonly SessionListItem[],
): string | null {
  const pendingCreatedId = state.sessionOrder.find(
    (id) => state.pendingCreatedSessionIds[id] && state.sessions[id],
  );
  if (pendingCreatedId) return pendingCreatedId;
  return visibleItems.find((item) => item.messageCount > 0)?.sessionId
    ?? visibleItems[0]?.sessionId
    ?? null;
}

function readFirstAvailableSessionId(state: StoreState, excludedSessionId?: string): string | null {
  return state.sessionOrder.find(
    (id) =>
      id !== excludedSessionId &&
      Boolean(state.sessions[id]) &&
      !state.missingOnServerIds[id] &&
      !state.pendingDeletedSessionIds[id],
  ) ?? null;
}

function mergeSessionOrder(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const group of groups) {
    for (const id of group) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

export function deleteSessionRuntimeState(state: StoreState, sessionId: string): void {
  delete state.sessions[sessionId];
  delete state.historyLoadedIds[sessionId];
  delete state.historyLoadingIds[sessionId];
  delete state.historyFailedIds[sessionId];
  delete state.historyReplayBuffers[sessionId];
  delete state.historyStepBuffers[sessionId];
  delete state.viewedRunIdBySession[sessionId];
  delete state.missingOnServerIds[sessionId];
  state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
}
