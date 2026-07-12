import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import {
  type AgentTerminalActivityTone,
  type AgentTerminalActivityGroup,
  type AgentTerminalActivityView,
  type AgentTerminalDetailMode,
  type AgentTerminalTimelinePatch,
  type AgentTerminalTimelineViewState,
} from "./AgentTerminalActivity.js";

const NumberFormatter = new Intl.NumberFormat("zh-CN");

export function patchWithActivity(
  activity: AgentTerminalActivityView,
  extra: Omit<AgentTerminalTimelinePatch, "upserts"> = {},
): AgentTerminalTimelinePatch {
  return {
    ...extra,
    upserts: [activity],
  };
}

export function patchWithStepActivity(
  event: AgentEventEnvelope<string, unknown>,
  group: AgentTerminalActivityGroup | undefined,
  activity: Omit<AgentTerminalActivityView, "key" | "groupKey"> & { slot: string },
  silent = false,
): AgentTerminalTimelinePatch {
  return {
    groups: group ? [group] : undefined,
    upserts: [
      {
        key: activityKey(event, activity.slot),
        groupKey: group?.key,
        title: activity.title,
        summary: activity.summary,
        detail: activity.detail,
        tone: activity.tone,
        state: activity.state,
      },
    ],
    silent,
  };
}

export function mergeStepActivity(
  event: AgentEventEnvelope<string, unknown>,
  state: AgentTerminalTimelineViewState,
  slot: string,
  title: string,
  summary: string | undefined,
  tone: AgentTerminalActivityTone,
  activityState: "active" | "completed",
): AgentTerminalActivityView {
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
  state: AgentTerminalTimelineViewState,
  slot: string,
  title: string,
  tone: AgentTerminalActivityTone,
): AgentTerminalTimelinePatch {
  const key = activityKey(event, slot);
  const existing = state.activities.get(key);
  return {
    upserts: [
      {
        key,
        groupKey: existing?.groupKey ?? statefulStepGroup(event)?.key,
        title,
        summary: existing?.summary ?? compactSummary(formatStep(event.step)),
        detail: existing?.detail,
        tone,
        state: "completed",
      },
    ],
  };
}

export function statefulStepGroup(event: AgentEventEnvelope<string, unknown>): AgentTerminalActivityGroup | undefined {
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

export function shouldRenderDetails(mode: AgentTerminalDetailMode, category: "errors" | "tools" | "xml"): boolean {
  const catalog: Record<AgentTerminalDetailMode, string[]> = {
    none: [],
    errors: ["errors"],
    tools: ["tools"],
    xml: ["xml"],
    all: ["errors", "tools", "xml"],
  };

  return catalog[mode].includes(category);
}

export function silentPatch(): AgentTerminalTimelinePatch {
  return {
    silent: true,
  };
}

export function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

export function formatToolIndex(value: unknown): string | undefined {
  const index = readNumber(value);
  return index === undefined ? undefined : `工具 ${NumberFormatter.format(index + 1)}`;
}

export function formatCallHandle(value: unknown): string | undefined {
  return readString(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readRequestHandle(value: unknown): string | undefined {
  const requestId = readString(value);
  return requestId ? requestId.replace(/_/g, ":") : undefined;
}
