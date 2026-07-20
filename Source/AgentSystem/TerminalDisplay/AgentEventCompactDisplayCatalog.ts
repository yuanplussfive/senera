import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import { describeSessionHandle } from "../Core/AgentIds.js";
import type { AgentCompactEventDisplay, AgentCompactEventFormatter } from "./AgentEventDisplayTypes.js";
import { eventDisplayMessage } from "./AgentEventDisplayMessages.js";
import { normalizeRecord, readRequestHandle, readStringToken } from "./AgentEventDisplayValueReaders.js";
import {
  formatActiveRequestToken,
  formatCountToken,
  formatEntryCountToken,
  formatInteractionModeToken,
  formatPlannerStageToken,
  formatStepToken,
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
  "run.cancellation.progress": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "任务取消进度",
      tokens: [
        readRequestHandle(event.requestId),
        readStringToken(data.stage),
        readStringToken(data.component),
        typeof data.durationMs === "number" ? `${data.durationMs}ms` : undefined,
      ],
    };
  },
  "interaction.input.requested": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "工具等待用户输入",
      tokens: [formatStepToken(event.step), readStringToken(data.toolName), readStringToken(data.interactionId)],
    };
  },
  "interaction.input.resolved": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "工具用户输入已处理",
      tokens: [formatStepToken(event.step), readStringToken(data.toolName), readStringToken(data.action)],
    };
  },
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
  "action.planner.stage.started": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "行动规划阶段开始",
      tokens: [formatStepToken(event.step), formatPlannerStageToken(data.stage)],
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
        data.repaired ? "已修复" : undefined,
      ],
    };
  },
  "action.planner.stage.failed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "行动规划阶段失败",
      tokens: [formatStepToken(event.step), formatPlannerStageToken(data.stage), readStringToken(data.message)],
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
      tokens: [formatStepToken(event.step), readStringToken(data.action), readStringToken(data.status)],
    };
  },
  "model.started": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "模型开始输出",
      tokens: [formatStepToken(event.step), readStringToken(data.model)],
    };
  },
  "model.completed": (event) => ({
    message: "模型输出完成",
    tokens: [formatStepToken(event.step)],
  }),
  "pi.trace": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "Pi 原生轨迹",
      tokens: [
        formatStepToken(event.step),
        readStringToken(data.source),
        readStringToken(data.eventType),
        readStringToken(data.summary),
      ],
    };
  },
  "tool.call.result.detail": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "工具结果详情",
      tokens: [formatStepToken(event.step), readStringToken(data.toolName), readStringToken(data.callId)],
    };
  },
  "sandbox.status.snapshot": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "安全沙箱状态",
      tokens: [
        readStringToken(data.platform),
        readStringToken(data.state),
        readStringToken(data.effectiveMode),
        readStringToken(data.message),
      ],
    };
  },
  "sandbox.install.started": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "安全沙箱初始化开始",
      tokens: [readStringToken(data.platform), readStringToken(data.message)],
    };
  },
  "sandbox.install.completed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "安全沙箱初始化完成",
      tokens: [readStringToken(data.status), readStringToken(data.message)],
    };
  },
  "sandbox.install.failed": (event) => {
    const data = normalizeRecord(event.data);
    return {
      message: "安全沙箱初始化失败",
      tokens: [readStringToken(data.message)],
    };
  },
  "run.completed": (event) => ({
    message: "任务完成",
    tokens: [readRequestHandle(event.requestId)],
  }),
};

export function fallbackCompactEventDisplay(event: AgentEventEnvelope<string, unknown>): AgentCompactEventDisplay {
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

function sessionEventDisplay(message: string, event: AgentEventEnvelope<string, unknown>): AgentCompactEventDisplay {
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
