import type { AgentEventEnvelope } from "../AgentEvent.js";
import { readXmlRootName } from "../Xml/AgentXmlRootReader.js";
import {
  AgentCliActivityTone,
  type AgentCliActivityGroup,
  type AgentCliActivityView,
  type AgentCliDetailMode,
  type AgentCliPreviewView,
  type AgentCliTimelinePatch,
  type AgentCliTimelineViewState,
} from "./AgentCliActivity.js";

const NumberFormatter = new Intl.NumberFormat("zh-CN");

export function patchWithActivity(
  activity: AgentCliActivityView,
  extra: Omit<AgentCliTimelinePatch, "upserts"> = {},
): AgentCliTimelinePatch {
  return {
    ...extra,
    upserts: [activity],
  };
}

export function patchWithStepActivity(
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

export function mergeStepActivity(
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

export function keepExistingStepActivity(
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

export function statefulStepGroup(event: AgentEventEnvelope<string, unknown>): AgentCliActivityGroup | undefined {
  const step = readNumber(event.step);
  return step === undefined
    ? undefined
    : {
        key: `step:${step}`,
        title: `第 ${NumberFormatter.format(step)} 步`,
        summary: readRequestHandle(event.requestId),
      };
}

export function activityKey(event: AgentEventEnvelope<string, unknown>, slot: string): string {
  const step = readNumber(event.step);
  return step === undefined ? slot : `step:${step}:${slot}`;
}

export function buildPreview(event: AgentEventEnvelope<string, unknown>): AgentCliPreviewView | undefined {
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
      readXmlRootName(xml),
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

export function cacheDecisionXml(
  state: AgentCliTimelineViewState,
  event: AgentEventEnvelope<string, unknown>,
): void {
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

export function buildRetrySummaryDetail(
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

export function summarizeRetryDetail(data: Record<string, unknown>): Record<string, unknown> {
  const instruction = normalizeRecord(data.instruction);
  return {
    code: readString(instruction.code),
    message: readString(instruction.message),
    retryable: instruction.retryable,
  };
}

export function shouldRenderDetails(
  mode: AgentCliDetailMode,
  category: "errors" | "tools" | "xml",
): boolean {
  const catalog: Record<AgentCliDetailMode, string[]> = {
    none: [],
    errors: ["errors"],
    tools: ["tools"],
    xml: ["xml"],
    all: ["errors", "tools", "xml"],
  };

  return catalog[mode].includes(category);
}

export function silentPatch(): AgentCliTimelinePatch {
  return {
    silent: true,
  };
}

export function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function compactSummary(...values: Array<string | undefined>): string | undefined {
  const filtered = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  return filtered.length > 0 ? filtered.join(" · ") : undefined;
}

export function formatStep(value: unknown): string | undefined {
  const step = readNumber(value);
  return step === undefined ? undefined : `第 ${NumberFormatter.format(step)} 步`;
}

export function formatCount(value: unknown, unit: string): string | undefined {
  const number = readNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}${unit}`;
}

export function formatAttempt(value: unknown): string | undefined {
  const attempt = readNumber(value);
  return attempt === undefined ? undefined : `第 ${NumberFormatter.format(attempt)} 次`;
}

export function formatToolIndex(value: unknown): string | undefined {
  const index = readNumber(value);
  return index === undefined ? undefined : `工具 ${NumberFormatter.format(index + 1)}`;
}

export function formatCallHandle(value: unknown): string | undefined {
  return readString(value);
}

export function formatStopReason(value: unknown): string | undefined {
  const catalog: Record<string, string> = {
    root_closed: "已闭合",
    stream_completed: "流结束",
  };
  const reason = readString(value);
  return reason ? catalog[reason] ?? reason : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function readRequestHandle(value: unknown): string | undefined {
  const requestId = readString(value);
  return requestId ? requestId.replace(/_/g, ":") : undefined;
}

export function readToolCallNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => normalizeRecord(entry))
        .map((entry) => readString(entry.name))
        .filter((entry): entry is string => typeof entry === "string")
    : [];
}
