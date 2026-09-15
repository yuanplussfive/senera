import { Temporal } from "@js-temporal/polyfill";
import type { AgentTemporalMemoryGranularity, AgentTemporalMemoryRange } from "./AgentTemporalMemoryTypes.js";

export interface AgentTemporalMemoryPeriod {
  readonly key: string;
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant;
}

export function agentTemporalMemoryCalendarPeriod(
  granularity: Exclude<AgentTemporalMemoryGranularity, "segment">,
  instant: Temporal.Instant,
  timeZone: string,
): AgentTemporalMemoryPeriod {
  const local = instant.toZonedDateTimeISO(timeZone);
  if (granularity === "day") {
    const start = local.startOfDay();
    return {
      key: start.toPlainDate().toString(),
      start: start.toInstant(),
      end: start.add({ days: 1 }).toInstant(),
    };
  }
  const start = local.with({ day: 1 }).startOfDay();
  return {
    key: Temporal.PlainYearMonth.from({ year: start.year, month: start.month }).toString(),
    start: start.toInstant(),
    end: start.add({ months: 1 }).toInstant(),
  };
}

export function agentTemporalMemoryDayBoundary(instant: Temporal.Instant, timeZone: string): Temporal.Instant {
  return instant.toZonedDateTimeISO(timeZone).startOfDay().add({ days: 1 }).toInstant();
}

export function agentTemporalMemoryRange(start: string, end: string, timeZone: string): AgentTemporalMemoryRange {
  const startInstant = parseRangeBoundary(start, timeZone, "start");
  const endInstant = parseRangeBoundary(end, timeZone, "end");
  if (Temporal.Instant.compare(endInstant, startInstant) <= 0) {
    throw new Error("Temporal memory range end must be later than its start.");
  }
  return {
    start: startInstant.toString(),
    end: endInstant.toString(),
    startMs: Number(startInstant.epochMilliseconds),
    endMs: Number(endInstant.epochMilliseconds),
    timeZone,
  };
}

function parseRangeBoundary(value: string, timeZone: string, edge: "start" | "end"): Temporal.Instant {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Temporal memory range ${edge} must not be empty.`);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    const date = Temporal.PlainDate.from(normalized);
    const local = date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") });
    return (edge === "start" ? local : local.add({ days: 1 })).toInstant();
  }
  return Temporal.Instant.from(normalized);
}
