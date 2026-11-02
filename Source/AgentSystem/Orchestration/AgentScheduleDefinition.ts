import { Cron } from "croner";
import { Temporal } from "@js-temporal/polyfill";
import { RRuleTemporal } from "rrule-temporal";
import { DefaultAgentTimeZone, normalizeAgentScheduleInstant } from "../Time/AgentTime.js";

export type ScheduledTaskType = "cron" | "once" | "interval";
export type ScheduledTaskStatus = "success" | "error" | "running";
export interface TaskSchedulerScope {
  tenantId?: string;
  userId?: string;
}
export interface ScheduledTaskRunHistoryEntry {
  id: string;
  status: ScheduledTaskStatus | "paused" | "resumed";
  createdAt: string;
  sessionId?: string;
  message?: string;
}
export interface ScheduledTask {
  id: string;
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  sessionId: string;
  name?: string;
  description?: string;
  prompt: string;
  type: ScheduledTaskType;
  schedule: string;
  intervalSeconds: number;
  enabled: boolean;
  model: {
    provider: string;
    model: string;
    thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    authProfileId?: string;
    reasoning?: boolean;
  };
  toolPolicyProfile: string;
  workspaceDir?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  timeoutMs?: number;
  lastStatus?: ScheduledTaskStatus;
  lastError?: string;
  runHistory?: ScheduledTaskRunHistoryEntry[];
  timeZone?: string;
  target?: "this_session" | "new_once" | "new";
  targetSessionId?: string;
}
export type ScheduledTaskCreateInput = Omit<ScheduledTask, "id" | "createdAt" | "updatedAt" | "runCount">;
export type ScheduledTaskUpdate = Partial<ScheduledTask>;

const DurationSeconds = { s: 1, m: 60, h: 3600, d: 86400 } as const;

function durationSeconds(input: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.trim());
  if (!match) throw new Error("Use a positive duration such as 30s, 5m, 1h or 1d.");
  const seconds = Number(match[1]) * DurationSeconds[match[2] as keyof typeof DurationSeconds];
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("Duration must be a positive safe integer.");
  return seconds;
}

export function resolveScheduledTaskDefinition(input: {
  type: ScheduledTaskType;
  schedule: string;
  timeZone?: string;
  now?: string;
}): Pick<ScheduledTask, "type" | "schedule" | "intervalSeconds"> {
  const schedule = input.schedule.trim();
  if (!schedule) throw new Error("Schedule must not be empty.");
  const timeZone = input.timeZone ?? DefaultAgentTimeZone;
  new Intl.DateTimeFormat("en", { timeZone }).format();
  if (input.type === "interval") return { type: input.type, schedule, intervalSeconds: durationSeconds(schedule) };
  if (input.type === "once") {
    const now = new Date(input.now ?? Date.now());
    const date = schedule.startsWith("+")
      ? new Date(now.getTime() + durationSeconds(schedule.slice(1)) * 1000)
      : new Date(Temporal.Instant.from(normalizeAgentScheduleInstant(schedule, timeZone)).epochMilliseconds);
    if (!Number.isFinite(date.getTime()) || date <= now)
      throw new Error("One-time schedules must specify a future instant.");
    return { type: input.type, schedule: date.toISOString(), intervalSeconds: 0 };
  }
  const canonical = schedule.startsWith("RRULE:")
    ? `${recurrenceStart(input.now ?? new Date().toISOString(), timeZone)}\n${schedule}`
    : schedule.replace(/^DTSTART;TZID=[^:]+:/m, `DTSTART;TZID=${timeZone}:`);
  nextAgentScheduleOccurrence({ type: "cron", schedule: canonical, timeZone }, input.now ?? new Date().toISOString());
  return { type: input.type, schedule: canonical, intervalSeconds: 0 };
}

/** Missed repeats coalesce into the most recent due occurrence. */
export function latestAgentScheduleOccurrence(task: ScheduledTask, due: string, now: string): string {
  if (task.type === "once") return due;
  const instant = new Date(now);
  if (task.type === "interval") {
    const interval = durationSeconds(task.schedule) * 1000;
    return new Date(
      new Date(due).getTime() + Math.floor((instant.getTime() - new Date(due).getTime()) / interval) * interval,
    ).toISOString();
  }
  if (/(?:^|\n)RRULE:/.test(task.schedule)) {
    const occurrence = recurrence(task.schedule).previous(instant, true);
    return occurrence ? new Date(occurrence.epochMilliseconds).toISOString() : due;
  }
  const cron = new Cron(task.schedule, { paused: true, timezone: task.timeZone ?? DefaultAgentTimeZone });
  try {
    return cron.previousRuns(1, new Date(instant.getTime() + 1))[0]?.toISOString() ?? due;
  } finally {
    cron.stop();
  }
}

/** DTSTART is a wall-clock value in TZID; the persisted anchor keeps COUNT/INTERVAL stable. */
function recurrenceStart(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `DTSTART;TZID=${timeZone}:${values.get("year")}${values.get("month")}${values.get("day")}T${values.get("hour")}${values.get("minute")}${values.get("second")}`;
}

export function nextAgentScheduleOccurrence(
  task: Pick<ScheduledTask, "type" | "schedule"> & Partial<Pick<ScheduledTask, "timeZone" | "intervalSeconds">>,
  after: string,
): string | undefined {
  if (task.type === "once") return new Date(normalizeAgentScheduleInstant(task.schedule, task.timeZone)).toISOString();
  if (task.type === "interval")
    return new Date(new Date(after).getTime() + durationSeconds(task.schedule) * 1000).toISOString();
  if (/(?:^|\n)RRULE:/.test(task.schedule)) {
    const occurrence = recurrence(task.schedule).next(new Date(after), false);
    return occurrence ? new Date(occurrence.epochMilliseconds).toISOString() : undefined;
  }
  const cron = new Cron(task.schedule, { paused: true, timezone: task.timeZone ?? DefaultAgentTimeZone });
  try {
    return cron.nextRun(new Date(after))?.toISOString();
  } finally {
    cron.stop();
  }
}

function recurrence(schedule: string) {
  return new RRuleTemporal({ rruleString: schedule, temporal: Temporal, strict: true });
}
