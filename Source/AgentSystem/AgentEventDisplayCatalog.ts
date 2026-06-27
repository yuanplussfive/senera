import type { AgentEventEnvelope } from "./AgentEvent.js";
import { describeSessionHandle } from "./AgentIds.js";

export type AgentEventDisplayMode = "activity" | "compact" | "verbose";

export interface AgentRenderedEventDisplay {
  label: string;
  message: string;
  tokens: string[];
  details: Record<string, unknown>;
}

interface AgentCompactEventDisplay {
  message: string;
  tokens?: Array<string | undefined>;
}

type AgentCompactEventFormatter =
  (event: AgentEventEnvelope<string, unknown>) => AgentCompactEventDisplay;

const NumberFormatter = new Intl.NumberFormat("zh-CN");

const EventMessageCatalog: Record<string, string> = {
  "session.created": "会话已创建",
  "session.snapshot": "会话快照",
  "session.closed": "会话已关闭",
  "session.busy": "会话忙碌",
  "session.not_found": "会话不存在",
  "run.started": "任务开始",
  "prompt.summary": "提示词摘要",
  "prompt.rendered": "提示词已渲染",
  "action.planner.stage.started": "行动规划阶段开始",
  "action.planner.stage.completed": "行动规划阶段完成",
  "action.planner.stage.failed": "行动规划阶段失败",
  "interaction.routed": "运行路径已选择",
  "action.planned": "行动规划完成",
  "model.started": "模型开始输出",
  "model.stream.opened": "模型流已打开",
  "model.stream.aborted": "模型流已停止",
  "model.delta": "",
  "model.completed": "模型输出完成",
  "decision.xml.progress": "XML 组装中",
  "decision.xml.ready": "XML 已就绪",
  "decision.xml.limit_reached": "XML 超出限制",
  "decision.xml.summary": "XML 摘要已生成",
  "decision.xml.detail": "XML 详情已生成",
  "decision.parsed": "决策摘要已生成",
  "decision.parsed.detail": "决策详情已生成",
  "retry.planned": "重试计划已生成",
  "retry.detail": "重试详情已生成",
  "tool.results": "工具结果摘要已生成",
  "tool.results.detail": "工具结果详情已生成",
  "final.answer": "最终回答",
  "ask.user": "需要用户补充",
  "run.failed": "任务失败",
  "run.completed": "任务完成",
  "request.invalid": "请求无效",
  "config.reloaded": "配置已热更新",
  "config.failed": "配置热更新失败",
  "model.list.snapshot": "模型列表已同步",
  "plugin.config.snapshot": "插件配置已同步",
  "profile.snapshot": "用户资料已同步",
};

const CompactEventCatalog: Partial<Record<string, AgentCompactEventFormatter>> = {
  "session.created": (event) => sessionEventDisplay("会话已创建", event),
  "session.snapshot": (event) => sessionEventDisplay("会话快照", event),
  "session.closed": (event) => sessionEventDisplay("会话已关闭", event),
  "run.started": (event) => ({
    message: "任务开始",
    tokens: [readRequestHandle(event.requestId)],
  }),
  "prompt.summary": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "提示词摘要",
      tokens: [
        formatStepToken(event.step),
        formatCountToken(data.chars, "字"),
        formatCountToken(data.lines, "行"),
        formatCountToken(data.tokenCount, "token"),
      ],
    };
  },
  "prompt.rendered": (event) => ({
    message: "提示词已渲染",
    tokens: [formatStepToken(event.step)],
  }),
  "action.planner.stage.started": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "行动规划阶段开始",
      tokens: [
        formatStepToken(event.step),
        formatPlannerStageToken(data.stage),
      ],
    };
  },
  "action.planner.stage.completed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "行动规划阶段完成",
      tokens: [
        formatStepToken(event.step),
        formatPlannerStageToken(data.stage),
        readStringToken(data.selectedAction),
        Boolean(data.repaired) ? "已修复" : undefined,
      ],
    };
  },
  "action.planner.stage.failed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "行动规划阶段失败",
      tokens: [
        formatStepToken(event.step),
        formatPlannerStageToken(data.stage),
        readStringToken(data.message),
      ],
    };
  },
  "interaction.routed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "运行路径已选择",
      tokens: [
        formatStepToken(event.step),
        formatInteractionModeToken(data.mode),
        readStringToken(data.expectedOutputMode),
      ],
    };
  },
  "action.planned": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "行动规划完成",
      tokens: [
        formatStepToken(event.step),
        readStringToken(data.action),
        readStringToken(data.status),
      ],
    };
  },
  "model.started": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "模型开始输出",
      tokens: [
        formatStepToken(event.step),
        readStringToken(data.model),
      ],
    };
  },
  "model.stream.opened": (event) => ({
    message: "模型流已打开",
    tokens: [formatStepToken(event.step)],
  }),
  "model.stream.aborted": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "模型流已停止",
      tokens: [
        formatStepToken(event.step),
        formatReasonToken(data.reason),
      ],
    };
  },
  "model.completed": (event) => ({
    message: "模型输出完成",
    tokens: [formatStepToken(event.step)],
  }),
  "decision.xml.ready": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "XML 已就绪",
      tokens: [
        formatStepToken(event.step),
        formatStopReasonToken(data.stopReason),
      ],
    };
  },
  "decision.xml.summary": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "XML 摘要已生成",
      tokens: [
        formatStepToken(event.step),
        readStringToken(data.root),
        formatCountToken(data.chars, "字"),
        formatCountToken(data.lines, "行"),
        Boolean(data.sanitized) ? "已净化" : undefined,
      ],
    };
  },
  "decision.parsed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "决策解析完成",
      tokens: [
        formatStepToken(event.step),
        readStringToken(data.decisionKind),
        readStringToken(data.root),
      ],
    };
  },
  "retry.planned": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "重试计划已生成",
      tokens: [
        formatStepToken(event.step),
        formatAttemptToken(data.attempt),
        readStringToken(data.code),
      ],
    };
  },
  "tool.results": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "工具结果已返回",
      tokens: [
        formatStepToken(event.step),
        formatToolCountToken(data.toolCount),
      ],
    };
  },
  "run.completed": (event) => ({
    message: "任务完成",
    tokens: [readRequestHandle(event.requestId)],
  }),
};

const VerboseHiddenKeys = new Set([
  "channel",
  "requestId",
  "timestamp",
  "data",
]);

export function renderAgentEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
  mode: AgentEventDisplayMode = "compact",
): AgentRenderedEventDisplay {
  return mode === "verbose"
    ? renderVerboseEventDisplay(event)
    : renderCompactEventDisplay(event);
}

function renderCompactEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
): AgentRenderedEventDisplay {
  const formatter = CompactEventCatalog[event.kind] ?? fallbackCompactEventDisplay;
  const rendered = formatter(event);

  return {
    label: event.kind,
    message: rendered.message,
    tokens: compactTokens(rendered.tokens ?? []),
    details: {},
  };
}

function renderVerboseEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
): AgentRenderedEventDisplay {
  const details = Object.fromEntries(
    Object.entries(event).filter(([key, value]) => !VerboseHiddenKeys.has(key) && value !== undefined),
  );

  return {
    label: event.kind,
    message: eventMessage(event.kind),
    tokens: [],
    details,
  };
}

function fallbackCompactEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
): AgentCompactEventDisplay {
  const data = normalizeRecord(event.data);
  return {
    message: eventMessage(event.kind),
    tokens: [
      formatStepToken(event.step),
      readStringToken(data.model),
      readStringToken(data.code),
      readStringToken(data.root),
    ],
  };
}

function sessionEventDisplay(
  message: string,
  event: AgentEventEnvelope<string, unknown>,
): AgentCompactEventDisplay {
  const data = normalizeRecord(event.data);

  return {
    message,
    tokens: [
      event.sessionId ? describeSessionHandle(event.sessionId) : undefined,
      formatTurnCountToken(data.turnCount),
      formatEntryCountToken(data.entryCount),
      formatActiveRequestToken(data.activeRequestId),
    ],
  };
}

function eventMessage(kind: string): string {
  return EventMessageCatalog[kind] ?? kind;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function compactTokens(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function formatStepToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `第${NumberFormatter.format(number)}步`;
}

function formatCountToken(value: unknown, unit: string): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}${unit}`;
}

function formatAttemptToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `第${NumberFormatter.format(number)}次`;
}

function formatToolCountToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}个结果`;
}

function formatTurnCountToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}轮`;
}

function formatEntryCountToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}条记录`;
}

function formatReasonToken(value: unknown): string | undefined {
  const reason = readNonEmptyString(value);
  return !reason || reason === "xml_root_closed" ? undefined : `原因 ${reason}`;
}

function formatStopReasonToken(value: unknown): string | undefined {
  const reason = readNonEmptyString(value);
  if (!reason) {
    return undefined;
  }

  const catalog: Record<string, string> = {
    root_closed: "已闭合",
    stream_completed: "流结束",
  };
  return catalog[reason] ?? reason;
}

function formatPlannerStageToken(value: unknown): string | undefined {
  const stage = readNonEmptyString(value);
  if (!stage) {
    return undefined;
  }

  const catalog: Record<string, string> = {
    understandUserTurn: "理解当前请求",
    buildTaskFrame: "构建任务合约",
    evaluateEvidence: "判断完成状态",
  };
  return catalog[stage] ?? stage;
}

function formatInteractionModeToken(value: unknown): string | undefined {
  const mode = readNonEmptyString(value);
  if (!mode) {
    return undefined;
  }

  const catalog: Record<string, string> = {
    direct_response: "直接回复",
    tool_agent_loop: "工具循环",
    deliberate_task_loop: "深度任务",
  };
  return catalog[mode] ?? mode;
}

function formatActiveRequestToken(value: unknown): string | undefined {
  const handle = readRequestHandle(value);
  return handle ? `处理中 ${handle}` : undefined;
}

function readRequestHandle(value: unknown): string | undefined {
  const requestId = readNonEmptyString(value);
  return requestId ? requestId.replace(/_/g, ":") : undefined;
}

function readStringToken(value: unknown): string | undefined {
  return readNonEmptyString(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
