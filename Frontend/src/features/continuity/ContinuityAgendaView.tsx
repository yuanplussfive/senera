import { CalendarClock, Flag, History, ListChecks, MapPin, PlayCircle, Route, SunMoon } from "lucide-react";
import type {
  AgendaRecordData,
  AgendaSnapshotData,
  ExecutionSnapshotData,
  TodoSnapshotData,
  WorldSnapshotData,
  ContinuitySnapshotData,
} from "../../api/eventTypes";
import { frontendMessage, type FrontendMessageKey } from "../../i18n/frontendMessageCatalog";
import { cn, formatDurationMs } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import { ContinuityEmptyText, ContinuityGroup, ContinuitySubsection } from "./ContinuityPanelPrimitives";
import { AgentWorldGraphView } from "./AgentWorldGraphView";

export function ContinuityAgendaView({
  agenda,
  world,
  run,
}: {
  agenda?: AgendaSnapshotData;
  world?: WorldSnapshotData;
  run?: RunRecord;
}): JSX.Element {
  const todos = run?.todos;
  const execution = run?.execution;
  return (
    <ContinuityGroup
      id="agenda"
      icon={CalendarClock}
      title="continuity.group.agenda"
      summary={
        world
          ? `${world.time.phaseLabel} · ${world.time.localTime}`
          : agenda
            ? `${agenda.clock.localDate} ${agenda.clock.localTime}`
            : undefined
      }
    >
      {world ? <WorldNow world={world} /> : null}
      {run?.continuity?.temporalMemory ? <TemporalMemoryOverview memory={run.continuity.temporalMemory} /> : null}
      {agenda && !world ? (
        <>
          <AgendaClock agenda={agenda} />
          <AgendaActivities agenda={agenda} />
          <AgendaGoals agenda={agenda} />
          <AgendaTimeline agenda={agenda} />
          <AgendaSchedules agenda={agenda} />
        </>
      ) : null}
      {world ? <WorldResident world={world} /> : null}
      {world ? <WorldUpcoming world={world} /> : null}
      {world ? <WorldCommitments world={world} /> : null}
      {world ? <WorldTimeline world={world} /> : null}
      {world ? <WorldGraph world={world} /> : null}
      <ExecutionList execution={execution} />
      <TodoList todos={todos} />
    </ContinuityGroup>
  );
}

function WorldCommitments({ world }: { world: WorldSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={Flag} title="continuity.agenda.longTermGoals">
      {world.commitments.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.agenda.emptyGoals")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2 border-l border-line-subtle pl-2.5">
          {world.commitments.map((commitment) => (
            <li key={commitment.id} className="min-w-0">
              <div className="flex min-w-0 items-start gap-1.5">
                <AgendaStatusIcon status={commitment.status} />
                <p className="min-w-0 flex-1 break-words text-[10.5px] font-medium leading-4 text-content-primary">
                  {commitment.label}
                </p>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 pl-[18px] text-[9.5px] leading-4 text-content-muted">
                <span>{commitment.actorRole}</span>
                {commitment.dueAt ? (
                  <time>
                    {frontendMessage("continuity.agenda.due", {
                      time: formatAgendaDateTime(commitment.dueAt, world.world.timeZone),
                    })}
                  </time>
                ) : null}
              </div>
              {commitment.detail ? (
                <p className="mt-1 break-words pl-[18px] text-[9.5px] leading-4 text-content-secondary">
                  {commitment.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function WorldTimeline({ world }: { world: WorldSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={History} title="continuity.agenda.todayTimeline">
      {world.timeline.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.agenda.emptyTimeline")}</ContinuityEmptyText>
      ) : (
        <ol className="space-y-2 border-l border-line-subtle pl-2.5">
          {world.timeline.map((entry) => (
            <li key={entry.id} className="relative min-w-0">
              <span
                className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-content-muted"
                aria-hidden="true"
              />
              <div className="flex min-w-0 items-baseline gap-2">
                <time className="shrink-0 font-mono text-[9.5px] tabular-nums leading-4 text-content-muted">
                  {formatAgendaTime(entry.occurredAt, world.world.timeZone)}
                </time>
                <p className="min-w-0 break-words text-[10.5px] leading-4 text-content-secondary">{entry.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </ContinuitySubsection>
  );
}

function TemporalMemoryOverview({
  memory,
}: {
  memory: NonNullable<ContinuitySnapshotData["temporalMemory"]>;
}): JSX.Element {
  const sealed = new Map(
    memory.counts
      .filter((entry) => entry.status === "sealed")
      .map((entry) => [entry.granularity, entry.count] as const),
  );
  const processing = memory.counts
    .filter((entry) => entry.status === "open" || entry.status === "pending")
    .reduce((total, entry) => total + entry.count, 0);
  const failedDigests = memory.counts
    .filter((entry) => entry.status === "failed")
    .reduce((total, entry) => total + entry.count, 0);
  const processingDecisions = memory.segmentDecisions.find((entry) => entry.status === "pending")?.count ?? 0;
  const failedDecisions = memory.segmentDecisions.find((entry) => entry.status === "failed")?.count ?? 0;
  const totalProcessing = processing + processingDecisions;
  const totalFailed = failedDigests + failedDecisions;
  return (
    <ContinuitySubsection icon={History} title="continuity.temporalMemory.title">
      {memory.counts.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.temporalMemory.empty")}</ContinuityEmptyText>
      ) : (
        <div className="border-l border-line-subtle pl-2.5">
          <p className="text-[9.5px] leading-4 text-content-muted">
            {frontendMessage("continuity.temporalMemory.counts", {
              segments: sealed.get("segment") ?? 0,
              days: sealed.get("day") ?? 0,
              months: sealed.get("month") ?? 0,
            })}
          </p>
          {totalProcessing > 0 || totalFailed > 0 ? (
            <p className="mt-0.5 text-[9.5px] leading-4 text-content-muted">
              {frontendMessage("continuity.temporalMemory.health", {
                processing: totalProcessing,
                failed: totalFailed,
              })}
            </p>
          ) : null}
          <ol className="mt-2.5 space-y-2.5">
            {memory.latestSealed.map((digest) => (
              <li key={digest.uri} className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-[9.5px] font-medium leading-4 text-accent-content">
                    {frontendMessage(temporalGranularityMessageKey(digest.granularity))}
                  </span>
                  <time className="min-w-0 truncate text-[9px] tabular-nums leading-4 text-content-muted">
                    {formatTemporalPeriod(digest.periodStart, digest.periodEnd, digest.timeZone, digest.granularity)}
                  </time>
                </div>
                <p className="mt-0.5 break-words text-[10.5px] leading-4 text-content-secondary">{digest.summary}</p>
                {digest.topics.length > 0 ? (
                  <p className="mt-0.5 break-words text-[9.5px] leading-4 text-content-muted">
                    {digest.topics.join(" · ")}
                  </p>
                ) : null}
                <p className="mt-0.5 text-[9px] leading-4 text-content-muted">
                  {frontendMessage("continuity.temporalMemory.sources", { count: digest.sourceCount })}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </ContinuitySubsection>
  );
}

function WorldNow({ world }: { world: WorldSnapshotData }): JSX.Element {
  const daySeconds = world.time.dayElapsedSeconds + world.time.dayRemainingSeconds;
  const elapsedPercent =
    daySeconds > 0 ? Math.min(100, Math.max(0, (world.time.dayElapsedSeconds / daySeconds) * 100)) : 0;
  return (
    <ContinuitySubsection icon={SunMoon} title="continuity.world.now">
      <div className="border-l-2 border-accent-border pl-2.5">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-medium leading-5 text-content-primary">
            {world.time.localDate} {world.time.weekdayLabel}
          </p>
          <time className="shrink-0 font-mono text-[11px] tabular-nums leading-5 text-content-primary">
            {world.time.localTime}
          </time>
        </div>
        <p className="mt-0.5 text-[9.5px] leading-4 text-content-muted">
          {world.time.phaseLabel} · {world.calendar.holidayName ?? world.calendar.lunarSummary}
        </p>
        <div className="mt-2 h-1 overflow-hidden bg-line-subtle" aria-hidden="true">
          <div className="h-full bg-accent-solid" style={{ width: `${elapsedPercent}%` }} />
        </div>
        <div className="mt-1 flex justify-between gap-2 text-[9px] leading-4 text-content-muted">
          <span>{frontendMessage("continuity.world.elapsed", { duration: world.time.dayElapsed })}</span>
          <span>{frontendMessage("continuity.world.remaining", { duration: world.time.dayRemaining })}</span>
        </div>
      </div>
    </ContinuitySubsection>
  );
}

function WorldResident({ world }: { world: WorldSnapshotData }): JSX.Element {
  const facts = [
    [frontendMessage("continuity.world.location"), world.resident.location],
    [frontendMessage("continuity.world.activity"), world.resident.activity],
    [frontendMessage("continuity.world.relationship"), world.resident.relationship],
    [frontendMessage("continuity.world.emotion"), world.resident.emotionState],
    [frontendMessage("continuity.world.body"), world.resident.bodyState],
    [frontendMessage("continuity.world.interruptedBy"), world.resident.interruptedBy],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <ContinuitySubsection icon={MapPin} title="continuity.world.resident">
      {facts.length === 0 && !world.resident.nextPlan ? (
        <ContinuityEmptyText>{frontendMessage("continuity.world.emptyResident")}</ContinuityEmptyText>
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 border-l border-line-subtle pl-2.5 text-[10px] leading-4">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-content-muted">{label}</dt>
              <dd className="min-w-0 break-words text-content-secondary">{value}</dd>
            </div>
          ))}
          {world.resident.nextPlan ? (
            <div className="contents">
              <dt className="text-content-muted">{frontendMessage("continuity.world.nextPlan")}</dt>
              <dd className="min-w-0 break-words text-content-primary">{world.resident.nextPlan.label}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </ContinuitySubsection>
  );
}

function WorldUpcoming({ world }: { world: WorldSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={CalendarClock} title="continuity.world.upcoming">
      {world.nextSchedules.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.world.emptyUpcoming")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2 border-l border-line-subtle pl-2.5">
          {world.nextSchedules.map((schedule) => (
            <li key={`${schedule.scheduleId}:${schedule.at}`} className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <time className="shrink-0 font-mono text-[9.5px] tabular-nums leading-4 text-content-muted">
                  {formatAgendaDateTime(schedule.at, world.world.timeZone)}
                </time>
                <p className="min-w-0 break-words text-[10.5px] leading-4 text-content-secondary">{schedule.label}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function WorldGraph({ world }: { world: WorldSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={Route} title="continuity.world.relations">
      {world.edges.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.world.emptyRelations")}</ContinuityEmptyText>
      ) : (
        <AgentWorldGraphView world={world} />
      )}
    </ContinuitySubsection>
  );
}

function AgendaClock({ agenda }: { agenda: AgendaSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={CalendarClock} title="continuity.agenda.now">
      <div className="border-l-2 border-accent-border pl-2.5">
        <p className="text-[11px] font-medium tabular-nums leading-5 text-content-primary">
          {agenda.clock.localDate} {agenda.clock.weekdayLabel} {agenda.clock.localTime}
        </p>
        <p className="mt-0.5 text-[9.5px] leading-4 text-content-muted">{agenda.clock.timeZone}</p>
      </div>
    </ContinuitySubsection>
  );
}

function AgendaActivities({ agenda }: { agenda: AgendaSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={PlayCircle} title="continuity.agenda.currentActivities">
      {agenda.currentActivities.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.agenda.emptyActivities")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2 border-l border-line-subtle pl-2.5">
          {agenda.currentActivities.map((activity) => (
            <li key={activity.id} className="min-w-0">
              <AgendaRecordLine record={activity} timeZone={agenda.world.timeZone} now={agenda.clock.instant} />
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function AgendaGoals({ agenda }: { agenda: AgendaSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={Flag} title="continuity.agenda.longTermGoals">
      {agenda.activeGoals.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.agenda.emptyGoals")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2 border-l border-line-subtle pl-2.5">
          {agenda.activeGoals.map((goal) => (
            <li key={goal.id} className="min-w-0">
              <AgendaRecordLine record={goal} timeZone={agenda.world.timeZone} now={agenda.clock.instant} />
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function AgendaTimeline({ agenda }: { agenda: AgendaSnapshotData }): JSX.Element {
  return (
    <ContinuitySubsection icon={Route} title="continuity.agenda.todayTimeline">
      {agenda.timeline.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.agenda.emptyTimeline")}</ContinuityEmptyText>
      ) : (
        <ol className="space-y-2 border-l border-line-subtle pl-2.5">
          {agenda.timeline.map((entry) => (
            <li key={entry.id} className="relative min-w-0">
              <span
                className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-content-muted"
                aria-hidden="true"
              />
              <div className="flex min-w-0 items-baseline gap-2">
                <time className="shrink-0 font-mono text-[9.5px] tabular-nums leading-4 text-content-muted">
                  {formatAgendaTime(entry.occurredAt, agenda.world.timeZone)}
                </time>
                <p className="min-w-0 break-words text-[10.5px] leading-4 text-content-secondary">{entry.summary}</p>
              </div>
              {entry.detail ? (
                <p className="mt-0.5 break-words text-[9.5px] leading-4 text-content-muted">{entry.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </ContinuitySubsection>
  );
}

function AgendaSchedules({ agenda }: { agenda: AgendaSnapshotData }): JSX.Element {
  const schedules = agenda.upcoming.filter((record) => record.kind === "schedule");
  return (
    <ContinuitySubsection icon={CalendarClock} title="continuity.agenda.upcoming">
      {schedules.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.agenda.emptyUpcoming")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-2 border-l border-line-subtle pl-2.5">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="min-w-0">
              <AgendaRecordLine record={schedule} timeZone={agenda.world.timeZone} now={agenda.clock.instant} />
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function AgendaRecordLine({
  record,
  timeZone,
  now,
}: {
  record: AgendaRecordData;
  timeZone: string;
  now: string;
}): JSX.Element {
  const elapsed = record.startsAt ? formatElapsed(record.startsAt, now) : "";
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-1.5">
        <AgendaStatusIcon status={record.status} />
        <p className="min-w-0 flex-1 break-words text-[10.5px] font-medium leading-4 text-content-primary">
          {record.summary}
        </p>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 pl-[18px] text-[9.5px] leading-4 text-content-muted">
        <span>{frontendMessage(agendaStatusMessageKey(record.status))}</span>
        {elapsed ? <span>{frontendMessage("continuity.agenda.elapsed", { duration: elapsed })}</span> : null}
        {record.dueAt ? (
          <time>
            {frontendMessage("continuity.agenda.due", { time: formatAgendaDateTime(record.dueAt, timeZone) })}
          </time>
        ) : null}
      </div>
      {record.detail ? (
        <p className="mt-1 break-words pl-[18px] text-[9.5px] leading-4 text-content-secondary">{record.detail}</p>
      ) : null}
    </div>
  );
}

function ExecutionList({ execution }: { execution?: ExecutionSnapshotData }): JSX.Element {
  const active = execution?.active;
  return (
    <ContinuitySubsection icon={Route} title="continuity.execution">
      {!active ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyExecution")}</ContinuityEmptyText>
      ) : (
        <div className="border-l border-line-subtle pl-2.5">
          <p className="break-words text-[10.5px] font-medium leading-4 text-content-primary">{active.objective}</p>
          <ul className="mt-2 space-y-1.5">
            {active.steps.map((step) => (
              <li
                key={step.id}
                className="flex min-w-0 items-start gap-1.5 text-[10px] leading-4 text-content-secondary"
              >
                <ExecutionStatusIcon status={step.status} />
                <span className="min-w-0 flex-1 break-words">{step.detail || step.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ContinuitySubsection>
  );
}

function TodoList({ todos }: { todos?: TodoSnapshotData }): JSX.Element {
  const items = todos?.items ?? [];
  return (
    <ContinuitySubsection icon={ListChecks} title="continuity.todos">
      {items.length === 0 ? (
        <ContinuityEmptyText>{frontendMessage("continuity.emptyTodos")}</ContinuityEmptyText>
      ) : (
        <ul className="space-y-1.5 border-l border-line-subtle pl-2.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 items-start gap-1.5 text-[10.5px] leading-4 text-content-secondary"
            >
              <TodoStatusIcon status={item.status} />
              <span className="min-w-0 flex-1 break-words">{item.content}</span>
            </li>
          ))}
        </ul>
      )}
    </ContinuitySubsection>
  );
}

function AgendaStatusIcon({ status }: { status: AgendaRecordData["status"] }): JSX.Element {
  const className =
    status === "completed" || status === "recorded"
      ? "bg-moss-500"
      : status === "cancelled"
        ? "bg-content-disabled"
        : "bg-accent-solid";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function ExecutionStatusIcon({
  status,
}: {
  status: NonNullable<ExecutionSnapshotData["active"]>["steps"][number]["status"];
}): JSX.Element {
  const className =
    status === "completed"
      ? "bg-moss-500"
      : status === "failed" || status === "blocked"
        ? "bg-red-500"
        : "bg-content-disabled";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function TodoStatusIcon({ status }: { status: TodoSnapshotData["items"][number]["status"] }): JSX.Element {
  const className =
    status === "completed"
      ? "bg-moss-500"
      : status === "cancelled"
        ? "bg-content-disabled"
        : status === "in_progress"
          ? "bg-accent-solid"
          : "bg-content-disabled";
  return <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

function agendaStatusMessageKey(status: AgendaRecordData["status"]): FrontendMessageKey {
  return `continuity.agenda.status.${status}` as FrontendMessageKey;
}

function formatAgendaTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function temporalGranularityMessageKey(granularity: "segment" | "day" | "month"): FrontendMessageKey {
  return `continuity.temporalMemory.granularity.${granularity}` as FrontendMessageKey;
}

function formatTemporalPeriod(
  start: string,
  end: string,
  timeZone: string,
  granularity: "segment" | "day" | "month",
): string {
  const options: Intl.DateTimeFormatOptions =
    granularity === "segment"
      ? { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : granularity === "day"
        ? { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }
        : { timeZone, year: "numeric", month: "long" };
  const formatter = new Intl.DateTimeFormat(undefined, options);
  if (granularity !== "segment") return formatter.format(new Date(start));
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function formatAgendaDateTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function formatElapsed(start: string, now: string): string {
  const milliseconds = new Date(now).getTime() - new Date(start).getTime();
  return Number.isFinite(milliseconds) && milliseconds > 0 ? formatDurationMs(milliseconds) : "";
}
