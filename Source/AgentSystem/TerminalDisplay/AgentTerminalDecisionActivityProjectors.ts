import {
  AgentTerminalActivityTone,
} from "./AgentTerminalActivity.js";
import type {
  AgentTerminalActivityProjectorCatalog,
} from "./AgentTerminalActivityProjectorTypes.js";
import {
  compactSummary,
  formatCount,
  formatStep,
  normalizeRecord,
  patchWithStepActivity,
  readString,
  silentPatch,
  statefulStepGroup,
} from "./AgentTerminalActivityProjectorUtils.js";

export const AgentTerminalDecisionActivityProjectors: AgentTerminalActivityProjectorCatalog = {
  "prompt.summary": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "prompt",
    title: "准备提示词",
    summary: compactSummary(
      formatStep(event.step),
      formatCount(normalizeRecord(event.data).chars, "字"),
      formatCount(normalizeRecord(event.data).lines, "行"),
      formatCount(normalizeRecord(event.data).tokenCount, "token"),
    ),
    tone: AgentTerminalActivityTone.Neutral,
    state: "completed",
  }),
  "model.started": (event) => patchWithStepActivity(event, statefulStepGroup(event), {
    slot: "model",
    title: "调用模型",
    summary: compactSummary(
      formatStep(event.step),
      readString(normalizeRecord(event.data).model),
      "流式输出中",
    ),
    tone: AgentTerminalActivityTone.Progress,
    state: "active",
  }),
  "model.completed": () => silentPatch(),
};
