export const DefaultAgentMemoryTimeZone = "Asia/Shanghai";

export interface AgentMemoryTimeProjection {
  epochMs: number;
  timeZone: string;
  localDate: string;
  localHour: string;
}

export function projectMemoryTime(isoText: string): AgentMemoryTimeProjection {
  const date = new Date(isoText);
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) {
    throw new Error(`Invalid memory timestamp: ${isoText}`);
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: DefaultAgentMemoryTimeZone,
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
    timeZone: DefaultAgentMemoryTimeZone,
    localDate,
    localHour: `${localDate}T${hour}`,
  };
}

function readTimePart(parts: Record<string, string>, key: string): string {
  const value = parts[key];
  if (!value) {
    throw new Error(`Intl time projection missing part: ${key}`);
  }
  return value;
}
