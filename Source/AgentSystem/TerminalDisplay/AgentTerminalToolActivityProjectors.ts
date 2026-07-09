import {
  AgentTerminalActivityTone,
} from "./AgentTerminalActivity.js";
import type {
  AgentTerminalActivityProjectorCatalog,
} from "./AgentTerminalActivityProjectorTypes.js";
import {
  activityKey,
  compactSummary,
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
} from "./AgentTerminalActivityProjectorUtils.js";

export const AgentTerminalToolActivityProjectors: AgentTerminalActivityProjectorCatalog = {
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
        ? "工具调用受阻"
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
      tone: AgentTerminalActivityTone.Progress,
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
        tone: AgentTerminalActivityTone.Progress,
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
        tone: AgentTerminalActivityTone.Success,
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
        tone: AgentTerminalActivityTone.Error,
        state: "completed",
      }],
    };
  },
  "tool.call.result.detail": (event, _state, detailMode) => shouldRenderDetails(detailMode, "tools")
    ? patchWithStepActivity(event, statefulStepGroup(event), {
        slot: `tools.detail:${readString(normalizeRecord(event.data).callId) || event.detailId || event.sequence}`,
        title: "工具结果详情",
        detail: normalizeRecord(event.data).value,
        tone: AgentTerminalActivityTone.Neutral,
        state: "completed",
      })
    : silentPatch(),
  "assistant.message.created": (event) => {
    const data = normalizeRecord(event.data);
    const messageKind = readString(data.kind) ?? "";
    const title = AssistantMessageActivityTitles[messageKind] ?? "助手消息";
    const tone = AssistantMessageActivityTones[messageKind] ?? AgentTerminalActivityTone.Neutral;
    return patchWithStepActivity(event, statefulStepGroup(event), {
      slot: `assistant:${readString(data.messageId) || event.sequence}`,
      title,
      detail: readString(data.content),
      tone,
      state: data.terminal === true ? "completed" : "active",
    });
  },
};

const AssistantMessageActivityTitles: Record<string, string> = {
  tool_preface: "工具调用前回复",
  final_answer: "最终回答",
  ask_user: "需要补充信息",
};

const AssistantMessageActivityTones: Record<string, AgentTerminalActivityTone> = {
  tool_preface: AgentTerminalActivityTone.Progress,
  final_answer: AgentTerminalActivityTone.Success,
  ask_user: AgentTerminalActivityTone.Warning,
};
