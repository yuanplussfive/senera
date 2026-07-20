import { AgentTerminalActivityTone } from "./AgentTerminalActivity.js";
import type { AgentTerminalActivityProjectorCatalog } from "./AgentTerminalActivityProjectorTypes.js";
import {
  compactSummary,
  normalizeRecord,
  patchWithActivity,
  readRequestHandle,
  readString,
} from "./AgentTerminalActivityProjectorUtils.js";

export const AgentTerminalLifecycleActivityProjectors: AgentTerminalActivityProjectorCatalog = {
  "session.created": (event) =>
    patchWithActivity({
      key: "session.lifecycle",
      title: "会话已创建",
      summary: compactSummary(readString(event.sessionId)),
      tone: AgentTerminalActivityTone.Neutral,
      state: "completed",
    }),
  "session.snapshot": (event) =>
    patchWithActivity({
      key: "session.lifecycle",
      title: "会话已恢复",
      summary: compactSummary(readString(event.sessionId)),
      tone: AgentTerminalActivityTone.Neutral,
      state: "completed",
    }),
  "session.closed": () =>
    patchWithActivity({
      key: "session.lifecycle",
      title: "会话已关闭",
      tone: AgentTerminalActivityTone.Neutral,
      state: "completed",
    }),
  "run.started": (event) =>
    patchWithActivity({
      key: "run.lifecycle",
      title: "开始处理",
      summary: compactSummary(readRequestHandle(event.requestId)),
      tone: AgentTerminalActivityTone.Progress,
      state: "active",
    }),
  "run.cancellation.progress": (event) => {
    const data = normalizeRecord(event.data);
    const stage = readString(data.stage);
    return patchWithActivity({
      key: "run.cancellation",
      title: stage === "completed" ? "旧任务已停止" : stage === "failed" ? "旧任务停止失败" : "正在停止旧任务",
      detail: data,
      tone: stage === "failed" ? AgentTerminalActivityTone.Error : AgentTerminalActivityTone.Progress,
      state: stage === "completed" || stage === "failed" ? "completed" : "active",
    });
  },
  "run.completed": (event) =>
    patchWithActivity(
      {
        key: "run.lifecycle",
        title: "任务完成",
        summary: compactSummary(readRequestHandle(event.requestId)),
        tone: AgentTerminalActivityTone.Success,
        state: "completed",
      },
      { clearPreview: true },
    ),
  "run.failed": (event) =>
    patchWithActivity(
      {
        key: "run.lifecycle",
        title: "任务失败",
        detail: normalizeRecord(event.data),
        tone: AgentTerminalActivityTone.Error,
        state: "completed",
      },
      { clearPreview: true },
    ),
  "request.invalid": (event) =>
    patchWithActivity(
      {
        key: "run.lifecycle",
        title: "请求无效",
        detail: normalizeRecord(event.data),
        tone: AgentTerminalActivityTone.Error,
        state: "completed",
      },
      { clearPreview: true },
    ),
};
