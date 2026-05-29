import type { AgentEventEnvelope } from "./AgentEvent.js";
import {
  AgentCliActivityTone,
  AgentCliDetailMode,
  type AgentCliActivityGroup,
  type AgentCliActivityProjector,
  type AgentCliActivityView,
  type AgentCliDetailMode as AgentCliDetailModeType,
  type AgentCliPreviewView,
  type AgentCliTimelinePatch,
  type AgentCliTimelineViewState,
} from "./AgentCliActivity.js";
import { readXmlRootName } from "./AgentXmlRootReader.js";

const NumberFormatter = new Intl.NumberFormat("zh-CN");

export interface AgentCliActivityProjectorOptions {
  detailMode?: AgentCliDetailModeType;
}

export function createCliActivityProjector(
  options: AgentCliActivityProjectorOptions = {},
): AgentCliActivityProjector {
  const detailMode = options.detailMode ?? AgentCliDetailMode.None;

  return (event, state) => (ActivityProjectors[event.kind] ?? fallbackProjector)(event, state, detailMode);
}

type Projector =
  (
    event: AgentEventEnvelope<string, unknown>,
    state: AgentCliTimelineViewState,
    detailMode: AgentCliDetailModeType,
  ) => AgentCliTimelinePatch;

const ActivityProjectors: Partial<Record<string, Projector>> = {
  "session.created": (event) => patchWithActivity({
    key: "session.lifecycle",
    title: "会话已创建",
    summary: compactSummary(readString(event.sessionId)),
    tone: AgentCliActivityTone.Neutral,
    state: "completed",
  }),
  "session.snapshot": (event) => patchWithActivity({
    key: "session.lifecycle",
    title: "会话已恢复",
    summary: compactSummary(readString(event.sessionId)),
    tone: AgentCliActivityTone.Neutral,
    state: "completed",
  }),
  "run.started": (event) => patchWithActivity({
    key: "run.lifecycle",
    title: "开始处理",
    summary: compactSummary(readRequestHandle(event.requestId)),
    tone: AgentCliActivityTone.Progress,
    state: "active",
  }),
  "prompt.summary": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "prompt",
    title: "准备提示词",
    summary: compactSummary(
      formatStep(event.step),
      formatCount(normalizeRecord(event.data).chars, "字"),
      formatCount(normalizeRecord(event.data).lines, "行"),
      formatCount(normalizeRecord(event.data).tokenCount, "token"),
    ),
    tone: AgentCliActivityTone.Neutral,
    state: "completed",
  }),
  "prompt.rendered": (event, state) => keepExistingStepActivity(
    event,
    state,
    "prompt",
    "提示词已就绪",
    AgentCliActivityTone.Success,
  ),
  "model.started": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "decision",
    title: "生成 XML 决策",
    summary: compactSummary(
      formatStep(event.step),
      readString(normalizeRecord(event.data).model),
      "流式输出中",
    ),
    tone: AgentCliActivityTone.Progress,
    state: "active",
  }),
  "decision.xml.progress": (event) => ({
    preview: buildPreview(event),
  }),
  "decision.xml.ready": (event, state) => ({
    upserts: [
      mergeStepActivity(
        event,
        state,
        "decision",
        "XML 输出完成",
        compactSummary(
          formatStep(event.step),
          formatStopReason(normalizeRecord(event.data).stopReason),
        ),
        AgentCliActivityTone.Success,
        "completed",
      ),
    ],
    clearPreview: true,
  }),
  "decision.xml.limit_reached": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "decision",
    title: "XML 超出限制",
    summary: compactSummary(
      formatStep(event.step),
      readString(normalizeRecord(event.data).code),
      formatCount(normalizeRecord(event.data).tokenCount, " token"),
      formatCount(normalizeRecord(event.data).tokenLimit, " 上限"),
    ),
    tone: AgentCliActivityTone.Error,
    state: "completed",
  }),
  "decision.xml.detail": (event, state, detailMode) => {
    cacheDecisionXml(state, event);
    return detailMode === AgentCliDetailMode.All || detailMode === AgentCliDetailMode.Xml
      ? patchWithStepActivity(event, statefulStepGroup(event), {
          slot: "decision.xml",
          title: "XML 明细",
          detail: String(normalizeRecord(event.data).xml ?? ""),
          tone: AgentCliActivityTone.Neutral,
          state: "completed",
        })
      : silentPatch();
  },
  "decision.xml.summary": (event, state, detailMode) => {
    cacheDecisionXml(state, event);
    return detailMode === AgentCliDetailMode.All || detailMode === AgentCliDetailMode.Xml
      ? patchWithStepActivity(event, statefulStepGroup(event), {
          slot: "decision.xml.summary",
          title: "XML 摘要",
          summary: compactSummary(
            formatStep(event.step),
            readString(normalizeRecord(event.data).root),
            formatCount(normalizeRecord(event.data).chars, "字"),
            formatCount(normalizeRecord(event.data).lines, "行"),
          ),
          tone: AgentCliActivityTone.Neutral,
          state: "completed",
        })
      : silentPatch();
  },
  "decision.parsed": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "parsed",
    title: "决策已解析",
    summary: compactSummary(
      formatStep(event.step),
      readString(normalizeRecord(event.data).decisionKind),
      readString(normalizeRecord(event.data).root),
    ),
    tone: AgentCliActivityTone.Success,
    state: "completed",
  }),
  "decision.parsed.detail": (event, _state, detailMode) => {
    const data = normalizeRecord(event.data);
    const payload = normalizeRecord(data.payload);
    const toolCalls = readToolCallNames(payload.tool_call);

    if (toolCalls.length === 0) {
      return silentPatch();
    }

    return patchWithStepActivity(event, statefulStepGroup(event), {
      slot: "tools",
      title: "已解析工具计划",
      summary: compactSummary(
        formatStep(event.step),
        `${toolCalls.length} 个工具`,
        toolCalls.join(", "),
      ),
      detail: shouldRenderDetails(detailMode, "tools")
        ? payload.tool_call
        : undefined,
      tone: AgentCliActivityTone.Progress,
      state: "active",
    });
  },
  "model.stream.opened": (_event, _state, _detailMode) => silentPatch(),
  "model.completed": (_event, _state, _detailMode) => silentPatch(),
  "model.stream.aborted": (event) => {
    const reason = readString(normalizeRecord(event.data).reason);
    return reason === "xml_root_closed"
      ? silentPatch()
      : patchWithStepActivity(event, statefulStepGroup(event), {
          slot: "decision",
          title: "模型流已停止",
          summary: compactSummary(formatStep(event.step), reason),
          tone: AgentCliActivityTone.Warning,
          state: "completed",
        });
  },
  "retry.planned": (event, state, detailMode) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "retry",
    title: "需要重试",
    summary: compactSummary(
      formatStep(event.step),
      formatAttempt(normalizeRecord(event.data).attempt),
      readString(normalizeRecord(event.data).code),
    ),
    detail: shouldRenderDetails(detailMode, "errors")
      ? buildRetrySummaryDetail(event, state)
      : undefined,
    tone: AgentCliActivityTone.Warning,
    state: "completed",
  }),
  "tool.calls.planned": (event, _state, detailMode) => {
    const data = normalizeRecord(event.data);
    const tools = Array.isArray(data.tools)
      ? data.tools.filter((entry): entry is string => typeof entry === "string")
      : [];

    return patchWithStepActivity(event, statefulStepGroup(event), {
      slot: "tools",
      title: "准备调用工具",
      summary: compactSummary(
        formatStep(event.step),
        formatCount(data.toolCount, "个工具"),
        tools.join(", "),
      ),
      detail: shouldRenderDetails(detailMode, "tools") ? tools : undefined,
      tone: AgentCliActivityTone.Progress,
      state: "active",
    });
  },
  "tool.call.started": (event, state) => {
    const data = normalizeRecord(event.data);
    const current = state.activities.get(activityKey(event, "tools"));
    return {
      upserts: [{
        key: activityKey(event, "tools"),
        groupKey: current?.groupKey ?? statefulStepGroup(event)?.key,
        title: "正在调用工具",
        summary: compactSummary(
          formatStep(event.step),
          formatToolIndex(data.index),
          readString(data.toolName),
          formatCallHandle(data.callId),
        ),
        detail: current?.detail,
        tone: AgentCliActivityTone.Progress,
        state: "active",
      }],
    };
  },
  "tool.call.completed": (event, state, detailMode) => {
    const data = normalizeRecord(event.data);
    const current = state.activities.get(activityKey(event, "tools"));
    return {
      upserts: [{
        key: activityKey(event, "tools"),
        groupKey: current?.groupKey ?? statefulStepGroup(event)?.key,
        title: "工具返回结果",
        summary: compactSummary(
          formatStep(event.step),
          formatToolIndex(data.index),
          readString(data.toolName),
          formatCallHandle(data.callId),
          readString(data.preview),
        ),
        detail: shouldRenderDetails(detailMode, "tools") ? current?.detail : undefined,
        tone: AgentCliActivityTone.Success,
        state: "active",
      }],
    };
  },
  "tool.call.failed": (event, state) => {
    const data = normalizeRecord(event.data);
    const current = state.activities.get(activityKey(event, "tools"));
    return {
      upserts: [{
        key: activityKey(event, "tools"),
        groupKey: current?.groupKey ?? statefulStepGroup(event)?.key,
        title: "工具调用失败",
        summary: compactSummary(
          formatStep(event.step),
          formatToolIndex(data.index),
          readString(data.toolName),
          formatCallHandle(data.callId),
          readString(data.code),
        ),
        detail: {
          message: readString(data.message),
        },
        tone: AgentCliActivityTone.Error,
        state: "completed",
      }],
    };
  },
  "retry.detail": (event, _state, detailMode) => shouldRenderDetails(detailMode, "errors")
    ? patchWithStepActivity(event, statefulStepGroup(event), {
        slot: "retry.detail",
        title: "重试详情",
        detail: summarizeRetryDetail(normalizeRecord(event.data)),
        tone: AgentCliActivityTone.Warning,
        state: "completed",
      })
    : silentPatch(),
  "tool.results": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "tools",
    title: "工具已返回",
    summary: compactSummary(
      formatStep(event.step),
      formatCount(normalizeRecord(event.data).toolCount, "个结果"),
    ),
    tone: AgentCliActivityTone.Success,
    state: "completed",
  }),
  "tool.results.detail": (event, _state, detailMode) => shouldRenderDetails(detailMode, "tools")
    ? patchWithStepActivity(event, statefulStepGroup(event), {
        slot: "tools.detail",
        title: "工具结果详情",
        detail: normalizeRecord(event.data).value,
        tone: AgentCliActivityTone.Neutral,
        state: "completed",
      })
    : silentPatch(),
  "final.answer": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "final",
    title: "最终回答",
    detail: String(normalizeRecord(event.data).content ?? ""),
    tone: AgentCliActivityTone.Success,
    state: "completed",
  }),
  "ask.user": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "ask",
    title: "需要补充信息",
    detail: String(normalizeRecord(event.data).question ?? ""),
    tone: AgentCliActivityTone.Warning,
    state: "completed",
  }),
  "run.completed": (event) => patchWithActivity({
    key: "run.lifecycle",
    title: "任务完成",
    summary: compactSummary(readRequestHandle(event.requestId)),
    tone: AgentCliActivityTone.Success,
    state: "completed",
  }, { clearPreview: true }),
  "run.failed": (event) => patchWithActivity({
    key: "run.lifecycle",
    title: "任务失败",
    detail: normalizeRecord(event.data),
    tone: AgentCliActivityTone.Error,
    state: "completed",
  }, { clearPreview: true }),
  "request.invalid": (event) => patchWithActivity({
    key: "run.lifecycle",
    title: "请求无效",
    detail: normalizeRecord(event.data),
    tone: AgentCliActivityTone.Error,
    state: "completed",
  }, { clearPreview: true }),
  "session.closed": () => patchWithActivity({
    key: "session.lifecycle",
    title: "会话已关闭",
    tone: AgentCliActivityTone.Neutral,
    state: "completed",
  }),
};

function fallbackProjector(): AgentCliTimelinePatch {
  return silentPatch();
}

function patchWithActivity(
  activity: AgentCliActivityView,
  extra: Omit<AgentCliTimelinePatch, "upserts"> = {},
): AgentCliTimelinePatch {
  return {
    ...extra,
    upserts: [activity],
  };
}

function patchWithStepActivity(
  event: AgentEventEnvelope<string, unknown>,
  group: AgentCliActivityGroup | undefined,
  activity: Omit<AgentCliActivityView, "key" | "groupKey"> & { slot: string },
  silent = false,
): AgentCliTimelinePatch {
  return {
    groups: group ? [group] : undefined,
    upserts: [{
      key: activityKey(event, activity.slot),
      groupKey: group?.key,
      title: activity.title,
      summary: activity.summary,
      detail: activity.detail,
      tone: activity.tone,
      state: activity.state,
    }],
    silent,
  };
}

function mergeStepActivity(
  event: AgentEventEnvelope<string, unknown>,
  state: AgentCliTimelineViewState,
  slot: string,
  title: string,
  summary: string | undefined,
  tone: AgentCliActivityTone,
  activityState: "active" | "completed",
): AgentCliActivityView {
  const key = activityKey(event, slot);
  const existing = state.activities.get(key);
  return {
    key,
    groupKey: existing?.groupKey ?? statefulStepGroup(event)?.key,
    title,
    summary,
    detail: existing?.detail,
    tone,
    state: activityState,
  };
}

function keepExistingStepActivity(
  event: AgentEventEnvelope<string, unknown>,
  state: AgentCliTimelineViewState,
  slot: string,
  title: string,
  tone: AgentCliActivityTone,
): AgentCliTimelinePatch {
  const key = activityKey(event, slot);
  const existing = state.activities.get(key);
  return {
    upserts: [{
      key,
      groupKey: existing?.groupKey ?? statefulStepGroup(event)?.key,
      title,
      summary: existing?.summary ?? compactSummary(formatStep(event.step)),
      detail: existing?.detail,
      tone,
      state: "completed",
    }],
  };
}

function statefulStepGroup(event: AgentEventEnvelope<string, unknown>): AgentCliActivityGroup | undefined {
  const step = readNumber(event.step);
  return step === undefined
    ? undefined
    : {
        key: `step:${step}`,
        title: `第 ${NumberFormatter.format(step)} 步`,
        summary: readRequestHandle(event.requestId),
      };
}

function activityKey(event: AgentEventEnvelope<string, unknown>, slot: string): string {
  const step = readNumber(event.step);
  return step === undefined ? slot : `step:${step}:${slot}`;
}

function buildPreview(event: AgentEventEnvelope<string, unknown>): AgentCliPreviewView | undefined {
  const data = normalizeRecord(event.data);
  const xml = String(data.xml ?? "");
  if (xml.length === 0) {
    return undefined;
  }

  const lines = xml.replace(/\r/g, "").split("\n");
  const visibleLines = lines.slice(-4);
  const hiddenCount = Math.max(lines.length - visibleLines.length, 0);

  return {
    key: `preview:${readNumber(event.step) ?? "na"}`,
    title: "XML 预览",
    summary: compactSummary(
      formatStep(event.step),
      readString(data.state),
      formatCount(xml.length, "字"),
      formatCount(lines.length, "行"),
      readRootName(xml),
    ) ?? "正在接收 XML",
    body: [
      ...(hiddenCount > 0 ? [`... 前面还有 ${hiddenCount} 行 ...`] : []),
      ...visibleLines,
    ],
    tone: readString(data.state) === "root_closed"
      ? AgentCliActivityTone.Success
      : AgentCliActivityTone.Progress,
  };
}

function cacheDecisionXml(state: AgentCliTimelineViewState, event: AgentEventEnvelope<string, unknown>): void {
  const step = readNumber(event.step);
  if (step === undefined) {
    return;
  }

  const data = normalizeRecord(event.data);
  const xml =
    typeof data.xml === "string" ? data.xml
      : typeof data.rawXml === "string" ? data.rawXml
        : undefined;

  if (xml) {
    state.decisionXmlByStep.set(step, xml);
  }
}

function buildRetrySummaryDetail(
  event: AgentEventEnvelope<string, unknown>,
  state: AgentCliTimelineViewState,
): Record<string, unknown> {
  const data = normalizeRecord(event.data);
  const step = readNumber(event.step);
  const xml = step === undefined ? undefined : state.decisionXmlByStep.get(step);

  return xml
    ? {
        message: readString(data.message) ?? "",
        xml,
      }
    : {
        message: readString(data.message) ?? "",
      };
}

function summarizeRetryDetail(data: Record<string, unknown>): Record<string, unknown> {
  const instruction = normalizeRecord(data.instruction);
  return {
    code: readString(instruction.code),
    message: readString(instruction.message),
    retryable: instruction.retryable,
  };
}

function shouldRenderDetails(
  mode: AgentCliDetailModeType,
  category: "errors" | "tools" | "xml",
): boolean {
  const catalog: Record<AgentCliDetailModeType, string[]> = {
    none: [],
    errors: ["errors"],
    tools: ["tools"],
    xml: ["xml"],
    all: ["errors", "tools", "xml"],
  };

  return catalog[mode].includes(category);
}

function silentPatch(): AgentCliTimelinePatch {
  return {
    silent: true,
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactSummary(...values: Array<string | undefined>): string | undefined {
  const filtered = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return filtered.length > 0 ? filtered.join(" · ") : undefined;
}

function formatStep(value: unknown): string | undefined {
  const step = readNumber(value);
  return step === undefined ? undefined : `第 ${NumberFormatter.format(step)} 步`;
}

function formatCount(value: unknown, unit: string): string | undefined {
  const number = readNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}${unit}`;
}

function formatAttempt(value: unknown): string | undefined {
  const attempt = readNumber(value);
  return attempt === undefined ? undefined : `第 ${NumberFormatter.format(attempt)} 次`;
}

function formatToolIndex(value: unknown): string | undefined {
  const index = readNumber(value);
  return index === undefined ? undefined : `工具 ${NumberFormatter.format(index + 1)}`;
}

function formatCallHandle(value: unknown): string | undefined {
  return readString(value);
}

function formatStopReason(value: unknown): string | undefined {
  const catalog: Record<string, string> = {
    root_closed: "已闭合",
    stream_completed: "流结束",
  };
  const reason = readString(value);
  return reason ? catalog[reason] ?? reason : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readRootName(xml: string): string | undefined {
  return readXmlRootName(xml);
}

function readRequestHandle(value: unknown): string | undefined {
  const requestId = readString(value);
  return requestId ? requestId.replace(/_/g, ":") : undefined;
}

function readToolCallNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => normalizeRecord(entry))
        .map((entry) => readString(entry.name))
        .filter((entry): entry is string => typeof entry === "string")
    : [];
}
