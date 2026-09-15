import { Temporal } from "@js-temporal/polyfill";
import type { AgentWorldDayPhase, AgentWorldTimeProjection } from "./AgentWorldTypes.js";

export function projectAgentWorldTime(input: {
  readonly instant: Temporal.Instant;
  readonly timeZone: string;
  readonly dayPhases: readonly AgentWorldDayPhase[];
}): AgentWorldTimeProjection {
  const timeZone = resolveWorldTimeZone(input.timeZone);
  const zoned = input.instant.toZonedDateTimeISO(timeZone);
  const phase = resolveDayPhase(zoned.toPlainTime(), input.dayPhases);
  const startOfDay = zoned.startOfDay();
  const endOfDay = startOfDay.add({ days: 1 });
  const dayElapsedSeconds = elapsedSeconds(startOfDay, zoned, "floor");
  const dayRemainingSeconds = elapsedSeconds(zoned, endOfDay, "ceil");

  return {
    instant: input.instant,
    timeZone,
    localDate: zoned.toPlainDate().toString(),
    localTime: zoned.toPlainTime().toString({ smallestUnit: "second" }),
    weekday: zoned.dayOfWeek,
    weekdayLabel: new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "long" }).format(
      new Date(input.instant.epochMilliseconds),
    ),
    phaseId: phase.id,
    phaseLabel: phase.label,
    dayElapsedSeconds,
    dayElapsed: formatAgentWorldSeconds(dayElapsedSeconds),
    dayRemainingSeconds,
    dayRemaining: formatAgentWorldSeconds(dayRemainingSeconds),
  };
}

export function durationBetween(from: Temporal.Instant, to: Temporal.Instant): Temporal.Duration {
  if (Temporal.Instant.compare(to, from) < 0) {
    throw new RangeError("World duration end must not precede its start.");
  }
  const totalSeconds = Math.floor((to.epochMilliseconds - from.epochMilliseconds) / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return Temporal.Duration.from({ days, hours, minutes, seconds });
}

export function formatAgentWorldDuration(duration: Temporal.Duration): string {
  const parts: string[] = [];
  if (duration.days) parts.push(`${duration.days}天`);
  if (duration.hours || (duration.days && duration.minutes)) parts.push(`${duration.hours}小时`);
  if (duration.minutes || duration.hours) parts.push(`${duration.minutes}分钟`);
  if (parts.length === 0 && duration.seconds) parts.push(`${duration.seconds}秒`);
  return parts.join("") || "刚刚";
}

/** Formats a non-negative wall-clock duration for UI and prompt projections. */
export function formatAgentWorldSeconds(totalSeconds: number): string {
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0) {
    throw new RangeError(`World duration seconds must be a non-negative safe integer: ${totalSeconds}`);
  }
  const duration = Temporal.Duration.from({
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  });
  return formatAgentWorldDuration(duration);
}

function resolveDayPhase(time: Temporal.PlainTime, phases: readonly AgentWorldDayPhase[]): AgentWorldDayPhase {
  validateAgentWorldDayPhases(phases);
  const minute = time.hour * 60 + time.minute;
  const matches = phases.filter((phase) => containsMinute(phase, minute));
  if (matches.length !== 1) {
    throw new Error(`World day phases must identify exactly one phase at ${time.toString()}.`);
  }
  return matches[0];
}

export function validateAgentWorldDayPhases(phases: readonly AgentWorldDayPhase[]): void {
  if (phases.length === 0) throw new Error("World definition requires at least one day phase.");
  const ids = new Set<string>();
  for (const phase of phases) {
    if (!phase.id.trim() || ids.has(phase.id))
      throw new Error(`World day phase id is duplicated or empty: ${phase.id}`);
    ids.add(phase.id);
    const startsAt = parseLocalMinutes(phase.startsAt);
    const endsAt = parseLocalMinutes(phase.endsAt);
    if (startsAt === endsAt) throw new Error(`World day phase cannot have zero duration: ${phase.id}`);
  }
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const matches = phases.filter((phase) => containsMinute(phase, minute));
    if (matches.length !== 1) {
      const localTime = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      throw new Error(`World day phases must cover ${localTime} exactly once.`);
    }
  }
}

function containsMinute(phase: AgentWorldDayPhase, minute: number): boolean {
  const startsAt = parseLocalMinutes(phase.startsAt);
  const endsAt = parseLocalMinutes(phase.endsAt);
  return startsAt < endsAt ? minute >= startsAt && minute < endsAt : minute >= startsAt || minute < endsAt;
}

function parseLocalMinutes(value: string): number {
  const match = /^(?<hour>\d{2}):(?<minute>\d{2})$/u.exec(value.trim());
  if (!match?.groups) throw new Error(`World local time must use HH:mm: ${value}`);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  if (hour > 23 || minute > 59) throw new Error(`World local time is out of range: ${value}`);
  return hour * 60 + minute;
}

function elapsedSeconds(from: Temporal.ZonedDateTime, to: Temporal.ZonedDateTime, rounding: "floor" | "ceil"): number {
  const seconds = Number(from.until(to, { largestUnit: "seconds" }).total({ unit: "seconds" }));
  return rounding === "floor" ? Math.floor(seconds) : Math.ceil(seconds);
}

function resolveWorldTimeZone(timeZone: string): string {
  const value = timeZone.trim();
  if (!value) throw new TypeError("World time zone must not be empty.");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new RangeError(`Unsupported world IANA time zone: ${value}.`);
  }
}
