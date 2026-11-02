import { Temporal } from "@js-temporal/polyfill";

export const DefaultAgentTimeZone = "Asia/Shanghai";
export type AgentTimeBoundary = "start" | "end-exclusive" | "end-inclusive";

export interface AgentTimeProjection {
  readonly epochMs: number;
  readonly timeZone: string;
  readonly localDate: string;
  readonly localHour: string;
}

/**
 * Durable storage and ordering keep epoch/UTC instants. Every outward text
 * projection uses the local zone with an explicit offset.
 */
export function projectAgentTime(isoText: string, timeZone = DefaultAgentTimeZone): AgentTimeProjection {
  const date = new Date(isoText);
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Invalid timestamp: ${isoText}`);
  }

  const resolvedTimeZone = resolveAgentTimeZone(timeZone);
  const parts = formatAgentTimeParts(date, resolvedTimeZone);
  const year = readTimePart(parts, "year");
  const month = readTimePart(parts, "month");
  const day = readTimePart(parts, "day");
  const hour = readTimePart(parts, "hour");
  const localDate = [year, month, day].join("-");

  return {
    epochMs,
    timeZone: resolvedTimeZone,
    localDate,
    localHour: `${localDate}T${hour}`,
  };
}

/** Formats a persisted instant as a stable, minute-precision local timestamp. */
export function formatAgentTimeMinute(isoText: string, timeZone = DefaultAgentTimeZone): string {
  const date = new Date(isoText);
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Invalid timestamp: ${isoText}`);
  }

  const resolvedTimeZone = resolveAgentTimeZone(timeZone);
  const parts = formatAgentTimeParts(date, resolvedTimeZone);
  return `${readTimePart(parts, "year")}-${readTimePart(parts, "month")}-${readTimePart(parts, "day")} ${readTimePart(parts, "hour")}:${readTimePart(parts, "minute")}`;
}

/** Compact chat labels retain the same zone and minute precision as other host timestamps. */
export function formatAgentTimeMonthDayMinute(isoText: string, timeZone = DefaultAgentTimeZone): string {
  const date = new Date(isoText);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid timestamp: ${isoText}`);
  const parts = formatAgentTimeParts(date, resolveAgentTimeZone(timeZone));
  return `${readTimePart(parts, "month")}/${readTimePart(parts, "day")} ${readTimePart(parts, "hour")}:${readTimePart(parts, "minute")}`;
}

/** Formats an instant as local ISO text with an explicit offset for model and human output. */
export function formatAgentTimeOffset(isoText: string, timeZone = DefaultAgentTimeZone): string {
  return projectZonedDateTime(isoText, timeZone).toString({ timeZoneName: "never" });
}

export function formatAgentTimeOffsetMillisecond(isoText: string, timeZone = DefaultAgentTimeZone): string {
  return projectZonedDateTime(isoText, timeZone).toString({
    smallestUnit: "millisecond",
    timeZoneName: "never",
  });
}

/** Best-effort CLI projection; malformed persisted values pass through unchanged. */
export function formatAgentTimeDisplay(value: string | undefined): string {
  if (!value) return "";
  try {
    return formatAgentTimeOffset(value);
  } catch {
    return value;
  }
}

/** Date-only input is a local calendar day; explicit instants are parsed as-is. */
export function parseAgentTimeBoundary(
  value: string,
  boundary: AgentTimeBoundary = "start",
  timeZone = DefaultAgentTimeZone,
): number {
  const normalized = value.trim();
  try {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
      const start = Temporal.PlainDate.from(normalized).toZonedDateTime(resolveAgentTimeZone(timeZone)).startOfDay();
      if (boundary === "start") return start.epochMilliseconds;
      const end = start.add({ days: 1 });
      return boundary === "end-exclusive" ? end.epochMilliseconds : end.epochMilliseconds - 1;
    }
    return Temporal.Instant.from(normalized).epochMilliseconds;
  } catch {
    throw new RangeError(`Invalid timestamp: ${value}`);
  }
}

/**
 * Schedule text without an offset is Shanghai wall-clock time. Relative
 * schedules (+10m) and explicit offsets pass through unchanged.
 */
export function normalizeAgentScheduleInstant(value: string, timeZone = DefaultAgentTimeZone): string {
  const normalized = value.trim();
  if (normalized.startsWith("+") || /(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized)) return value;
  const resolvedTimeZone = resolveAgentTimeZone(timeZone);
  try {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
      return Temporal.PlainDate.from(normalized).toZonedDateTime(resolvedTimeZone).startOfDay().toInstant().toString();
    }
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/u.test(normalized)) {
      return Temporal.PlainDateTime.from(normalized.replace(" ", "T"))
        .toZonedDateTime(resolvedTimeZone)
        .toInstant()
        .toString();
    }
  } catch {
    throw new RangeError(`Invalid timestamp: ${value}`);
  }
  return value;
}

/** Returns the canonical UTC representation used for persisted instants and duration calculations. */
export function currentAgentTimeIso(): string {
  return new Date().toISOString();
}

export function resolveAgentTimeZone(value: string): string {
  const timeZone = value.trim();
  if (!timeZone) {
    throw new TypeError("Time zone must not be empty.");
  }

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new RangeError(`Unsupported IANA time zone: ${timeZone}.`);
  }
}

function readTimePart(parts: Record<string, string>, key: string): string {
  const value = parts[key];
  if (!value) {
    throw new Error(`Intl time projection missing part: ${key}`);
  }
  return value;
}

function projectZonedDateTime(isoText: string, timeZone: string) {
  const epochMs = new Date(isoText).getTime();
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Invalid timestamp: ${isoText}`);
  }
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(resolveAgentTimeZone(timeZone));
}

function formatAgentTimeParts(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}
