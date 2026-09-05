import type Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentWorldEventLedger } from "./AgentWorldEventLedger.js";
import { projectAgentWorldTime } from "./AgentWorldTime.js";
import type { AgentWorldDayPhase } from "./AgentWorldTypes.js";

export interface AgentWorldClockAdvanceInput {
  readonly worldId: string;
  readonly timeZone: string;
  readonly dayPhases: readonly AgentWorldDayPhase[];
  readonly now: Temporal.Instant;
  readonly additionalWakeInstants?: readonly Temporal.Instant[];
  readonly wakeRequired?: boolean;
}

export interface AgentWorldClockState {
  readonly worldId: string;
  readonly lastAdvancedAt: Temporal.Instant;
  readonly nextWakeAt: Temporal.Instant;
  readonly changed: boolean;
}

interface ClockRow {
  readonly world_id: string;
  readonly last_advanced_at: string;
  readonly next_wake_at: string;
}

/** Time-zone-safe world clock that records coarse boundary crossings instead of minute ticks. */
export class AgentWorldClock {
  private readonly db: Database.Database;

  constructor(
    database: AgentSqliteDatabaseKernel | Database.Database,
    private readonly ledger: AgentWorldEventLedger,
  ) {
    this.db = "connection" in database ? database.connection : database;
  }

  advance(input: AgentWorldClockAdvanceInput): AgentWorldClockState {
    const nextWakeAt = input.wakeRequired
      ? input.now
      : earliestInstant([
          nextPhaseBoundary(input.now, input.timeZone, input.dayPhases),
          nextLocalMidnight(input.now, input.timeZone),
          ...(input.additionalWakeInstants ?? []).filter((instant) => Temporal.Instant.compare(instant, input.now) > 0),
        ]);
    const existing = this.read(input.worldId);
    if (!existing) {
      this.write(input.worldId, input.now, nextWakeAt);
      return { worldId: input.worldId, lastAdvancedAt: input.now, nextWakeAt, changed: false };
    }
    if (Temporal.Instant.compare(input.now, existing.lastAdvancedAt) < 0) {
      throw new Error("World clock cannot advance backwards.");
    }
    const previous = projectAgentWorldTime({
      instant: existing.lastAdvancedAt,
      timeZone: input.timeZone,
      dayPhases: input.dayPhases,
    });
    const current = projectAgentWorldTime({
      instant: input.now,
      timeZone: input.timeZone,
      dayPhases: input.dayPhases,
    });
    const changed = previous.localDate !== current.localDate || previous.phaseId !== current.phaseId;
    if (changed) {
      const crossedLocalDates = localDatesBetween(previous.localDate, current.localDate);
      this.ledger.append({
        worldId: input.worldId,
        timeZone: input.timeZone,
        subject: { id: input.worldId, kind: "state" },
        type: "clock.boundary_crossed",
        summary: `${previous.localDate} ${previous.phaseLabel} -> ${current.localDate} ${current.phaseLabel}`,
        changes: [
          {
            kind: "clock_advance",
            from: existing.lastAdvancedAt.toString(),
            to: input.now.toString(),
            previousPhaseId: previous.phaseId,
            phaseId: current.phaseId,
            crossedLocalDates,
          },
        ],
        evidenceRefs: [`senera://world-clock/${input.worldId}/${encodeURIComponent(input.now.toString())}`],
        occurredAt: input.now.toString(),
        recordedAt: input.now.toString(),
        idempotencyKey: `world-clock:${input.worldId}:${existing.lastAdvancedAt.toString()}:${input.now.toString()}`,
      });
    }
    this.write(input.worldId, input.now, nextWakeAt);
    return { worldId: input.worldId, lastAdvancedAt: input.now, nextWakeAt, changed };
  }

  state(worldId: string): AgentWorldClockState | undefined {
    const value = this.read(worldId);
    return value ? { worldId, ...value, changed: false } : undefined;
  }

  private read(worldId: string): Omit<AgentWorldClockState, "worldId" | "changed"> | undefined {
    const row = this.db
      .prepare<[string], ClockRow>(
        "SELECT world_id, last_advanced_at, next_wake_at FROM agent_world_clock WHERE world_id = ?",
      )
      .get(worldId);
    return row
      ? {
          lastAdvancedAt: Temporal.Instant.from(row.last_advanced_at),
          nextWakeAt: Temporal.Instant.from(row.next_wake_at),
        }
      : undefined;
  }

  private write(worldId: string, lastAdvancedAt: Temporal.Instant, nextWakeAt: Temporal.Instant): void {
    this.db
      .prepare(
        `INSERT INTO agent_world_clock (world_id, last_advanced_at, next_wake_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(world_id) DO UPDATE SET
           last_advanced_at = excluded.last_advanced_at,
           next_wake_at = excluded.next_wake_at,
           updated_at = excluded.updated_at`,
      )
      .run(worldId, lastAdvancedAt.toString(), nextWakeAt.toString(), lastAdvancedAt.toString());
  }
}

function nextPhaseBoundary(
  now: Temporal.Instant,
  timeZone: string,
  phases: readonly AgentWorldDayPhase[],
): Temporal.Instant {
  const zoned = now.toZonedDateTimeISO(timeZone);
  const today = zoned.toPlainDate();
  const candidates = phases.flatMap((phase) =>
    [today, today.add({ days: 1 })].map((date) =>
      date.toPlainDateTime(Temporal.PlainTime.from(phase.startsAt)).toZonedDateTime(timeZone).toInstant(),
    ),
  );
  return earliestInstant(candidates.filter((instant) => Temporal.Instant.compare(instant, now) > 0));
}

function nextLocalMidnight(now: Temporal.Instant, timeZone: string): Temporal.Instant {
  const tomorrow = now.toZonedDateTimeISO(timeZone).toPlainDate().add({ days: 1 });
  return tomorrow.toPlainDateTime(Temporal.PlainTime.from("00:00")).toZonedDateTime(timeZone).toInstant();
}

function earliestInstant(instants: readonly Temporal.Instant[]): Temporal.Instant {
  const first = instants.slice().sort(Temporal.Instant.compare)[0];
  if (!first) throw new Error("World clock requires at least one future wake instant.");
  return first;
}

function localDatesBetween(from: string, to: string): string[] {
  const first = Temporal.PlainDate.from(from);
  const last = Temporal.PlainDate.from(to);
  const dates: string[] = [];
  for (let cursor = first; Temporal.PlainDate.compare(cursor, last) <= 0; cursor = cursor.add({ days: 1 })) {
    dates.push(cursor.toString());
  }
  return dates;
}
