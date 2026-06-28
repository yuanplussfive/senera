import type { AgentEventEnvelope } from "../AgentEvent.js";
import { describeSessionHandle } from "../AgentIds.js";
import type {
  AgentCompactEventDisplay,
  AgentCompactEventFormatter,
} from "./AgentEventDisplayTypes.js";
import { eventDisplayMessage } from "./AgentEventDisplayMessages.js";
import {
  normalizeRecord,
  readRequestHandle,
  readStringToken,
} from "./AgentEventDisplayValueReaders.js";
import {
  formatActiveRequestToken,
  formatAttemptToken,
  formatCountToken,
  formatEntryCountToken,
  formatInteractionModeToken,
  formatPlannerStageToken,
  formatReasonToken,
  formatStepToken,
  formatStopReasonToken,
  formatToolCountToken,
  formatTurnCountToken,
} from "./AgentEventDisplayTokens.js";

export const CompactEventCatalog: Partial<Record<string, AgentCompactEventFormatter>> = {
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

export function fallbackCompactEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
): AgentCompactEventDisplay {
  const data = normalizeRecord(event.data);
  return {
    message: eventDisplayMessage(event.kind),
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
