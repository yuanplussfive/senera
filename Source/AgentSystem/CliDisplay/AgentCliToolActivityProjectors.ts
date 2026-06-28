import {
  AgentCliActivityTone,
} from "./AgentCliActivity.js";
import type {
  AgentCliActivityProjectorCatalog,
} from "./AgentCliActivityProjectorTypes.js";
import {
  activityKey,
  buildRetrySummaryDetail,
  compactSummary,
  formatAttempt,
  formatCallHandle,
  formatCount,
  formatStep,
  formatToolIndex,
  normalizeRecord,
  patchWithStepActivity,
  readString,
  shouldRenderDetails,
  silentPatch,
  statefulStepGroup,
  summarizeRetryDetail,
} from "./AgentCliActivityProjectorUtils.js";

export const AgentCliToolActivityProjectors: AgentCliActivityProjectorCatalog = {
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
  "retry.detail": (event, _state, detailMode) => shouldRenderDetails(detailMode, "errors")
    ? patchWithStepActivity(event, statefulStepGroup(event), {
        slot: "retry.detail",
        title: "重试详情",
        detail: summarizeRetryDetail(normalizeRecord(event.data)),
        tone: AgentCliActivityTone.Warning,
        state: "completed",
      })
    : silentPatch(),
  "tool.calls.planned": (event, _state, detailMode) => {
    const data = normalizeRecord(event.data);
    const tools = Array.isArray(data.tools)
      ? data.tools.filter((entry): entry is string => typeof entry === "string")
      : [];
    const status = typeof data.status === "string" ? data.status : "planned";
    const reason = typeof data.reason === "string" ? data.reason : undefined;
    const title = status === "discovery_escalated"
      ? "自动发现工具"
      : status === "blocked"
        ? "工具计划受阻"
        : "准备调用工具";

    return patchWithStepActivity(event, statefulStepGroup(event), {
      slot: "tools",
      title,
      summary: compactSummary(
        formatStep(event.step),
        formatCount(data.toolCount, "个工具"),
        reason,
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
};
