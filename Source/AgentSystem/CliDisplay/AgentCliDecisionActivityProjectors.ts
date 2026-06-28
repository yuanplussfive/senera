import {
  AgentCliActivityTone,
  AgentCliDetailMode,
} from "./AgentCliActivity.js";
import type {
  AgentCliActivityProjectorCatalog,
} from "./AgentCliActivityProjectorTypes.js";
import {
  buildPreview,
  cacheDecisionXml,
  compactSummary,
  formatCount,
  formatStep,
  formatStopReason,
  keepExistingStepActivity,
  mergeStepActivity,
  normalizeRecord,
  patchWithStepActivity,
  readString,
  readToolCallNames,
  shouldRenderDetails,
  silentPatch,
  statefulStepGroup,
} from "./AgentCliActivityProjectorUtils.js";

export const AgentCliDecisionActivityProjectors: AgentCliActivityProjectorCatalog = {
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
  "model.stream.opened": () => silentPatch(),
  "model.completed": () => silentPatch(),
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
};
