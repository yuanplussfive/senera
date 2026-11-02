import { Temporal } from "@js-temporal/polyfill";
import type { AgentSelfCommand, AgentSelfCommandOutput, AgentSelfServicePort } from "./AgentSelfServiceTypes.js";
import {
  AgentMemoryDiaryKeySchema,
  agentMemoryDiaryDate,
  type AgentMemoryDiaryConfig,
} from "../Continuity/AgentMemoryDiaryContract.js";
import { renderAgentMemoryDiaryIndex, type AgentMemoryDiaryStore } from "../Continuity/AgentMemoryDiaryStore.js";

export function createAgentSelfDiaryPort(input: {
  readonly defaultSubject?: () => string;
  readonly store: (agentId?: string) => AgentMemoryDiaryStore;
  readonly config: () => AgentMemoryDiaryConfig;
}): NonNullable<AgentSelfServicePort["diaries"]> {
  const scoped = (subject?: string): NonNullable<AgentSelfServicePort["diaries"]> => {
    const resolveStore = (agentId?: string) => {
      const store = input.store(agentId);
      const id = subject ?? input.defaultSubject?.();
      return id ? store.forSubject(id) : store;
    };
    return {
      forSubject: (id) => scoped(id),
      list: (period, agentId) => {
        const store = resolveStore(agentId);
        const config = input.config();
        const today = agentMemoryDiaryDate(new Date().toISOString(), config.TimeZone);
        if (!period) {
          const from = Temporal.PlainDate.from(today).subtract({ days: config.RecentDays }).toString();
          const to = Temporal.PlainDate.from(today).subtract({ days: 1 }).toString();
          return {
            index: store.recentIndex(today, config.RecentDays),
            entries: store.list({ from, to, period: "day" }),
          };
        }
        const key = AgentMemoryDiaryKeySchema.parse(period);
        const to =
          key.length === 7
            ? Temporal.PlainYearMonth.from(key)
                .add({ months: 1 })
                .toPlainDate({ day: 1 })
                .subtract({ days: 1 })
                .toString()
            : key;
        const entries = store.list({ from: key, to });
        return { index: renderAgentMemoryDiaryIndex(entries), entries };
      },
      read: (period, agentId) => resolveStore(agentId).read(AgentMemoryDiaryKeySchema.parse(period)),
    };
  };
  return scoped();
}

export function executeAgentSelfDiary(
  invocation: Extract<AgentSelfCommand, { command: "diary" }>,
  port: AgentSelfServicePort,
): AgentSelfCommandOutput {
  if (!port.diaries) return { ok: false, text: "当前宿主未绑定日记服务。", error: "diary_unavailable" };
  if (invocation.action === "list") {
    const result = port.diaries.list(invocation.period, invocation.agentId);
    return {
      ok: true,
      text: result.index || "该日期范围没有日记。",
      data: { entries: result.entries },
      model: { data: { count: result.entries.length } },
    };
  }
  const result = port.diaries.read(invocation.period, invocation.agentId);
  return result
    ? { ok: true, text: `# ${result.title}\n\n${result.body}`, data: { key: result.key, path: result.path } }
    : {
        ok: false,
        text: `${invocation.period} 尚无日记；日记在当天结束后生成，月记在月份结束后生成。`,
        error: "diary_missing",
      };
}
