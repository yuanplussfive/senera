import {
  AgentCliActivityTone,
} from "./AgentCliActivity.js";
import type {
  AgentCliActivityProjectorCatalog,
} from "./AgentCliActivityProjectorTypes.js";
import {
  compactSummary,
  normalizeRecord,
  patchWithActivity,
  readRequestHandle,
  readString,
} from "./AgentCliActivityProjectorUtils.js";

export const AgentCliLifecycleActivityProjectors: AgentCliActivityProjectorCatalog = {
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
  "session.closed": () => patchWithActivity({
    key: "session.lifecycle",
    title: "会话已关闭",
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
};
