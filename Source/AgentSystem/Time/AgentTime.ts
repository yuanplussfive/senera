export const DefaultAgentTimeZone = "Asia/Shanghai";

export interface AgentTimeProjection {
  readonly epochMs: number;
  readonly timeZone: string;
  readonly localDate: string;
  readonly localHour: string;
}

/**
 * Durable records retain UTC instants; this policy defines the product's
 * business-day boundary and human-facing calendar projection.
 */
export function projectAgentTime(isoText: string, timeZone = DefaultAgentTimeZone): AgentTimeProjection {
  const date = new Date(isoText);
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Invalid timestamp: ${isoText}`);
  }

  const resolvedTimeZone = resolveAgentTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: resolvedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
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
