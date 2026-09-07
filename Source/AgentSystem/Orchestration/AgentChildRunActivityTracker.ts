import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import {
  AgentChildRunCheckpointSources,
  type AgentChildRunCheckpoint,
  type AgentChildRunControlPolicy,
  type AgentChildRunControlSnapshot,
  type AgentChildRunDeadlinePolicy,
  type AgentChildRunSnapshot,
} from "./AgentChildRunTypes.js";
import { AgentTodoWriteSources, type AgentTodoItem, type AgentTodoStatus } from "../Todos/AgentTodoTypes.js";

const ChildRunTodoItemStatuses = new Set<AgentTodoStatus>(["pending", "in_progress", "completed", "cancelled"]);

function projectChildRunTodoItems(snapshot: unknown): AgentChildRunControlSnapshot["todo"]["items"] {
  const items = (snapshot as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return undefined;
  const projected: Array<Pick<AgentTodoItem, "content" | "status">> = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    const status = (item as { status?: unknown }).status;
    if (typeof content !== "string" || !content.trim()) continue;
    if (typeof status !== "string" || !ChildRunTodoItemStatuses.has(status as AgentTodoStatus)) continue;
    projected.push({ content: content.trim(), status: status as AgentTodoStatus });
  }
  return projected.length > 0 ? projected : undefined;
}

export interface AgentChildRunActivityClock {
  readonly now: () => number;
  readonly timestamp: (epochMilliseconds: number) => string;
}

export interface AgentChildRunActivityTrackerOptions {
  readonly startedAt: number;
  readonly policy: AgentChildRunDeadlinePolicy;
  readonly control?: AgentChildRunControlPolicy;
  /** Restores counters and deadline extensions when a persisted child resumes. */
  readonly initialSnapshot?: AgentChildRunSnapshot;
  readonly clock?: AgentChildRunActivityClock;
}

const SystemActivityClock: AgentChildRunActivityClock = {
  now: () => Date.now(),
  timestamp: (epochMilliseconds) => new Date(epochMilliseconds).toISOString(),
};

/** Builds bounded operational snapshots exclusively from typed runtime events. */
export class AgentChildRunActivityTracker {
  private readonly clock: AgentChildRunActivityClock;
  private readonly activeTools = new Map<string, string>();
  private readonly artifactUris = new Set<string>();
  private lastActivityAt: number;
  private lastModelOutputAt?: number;
  private modelOutputCharacters = 0;
  private assistantTurns = 0;
  private plannedToolCalls = 0;
  private startedToolCalls = 0;
  private completedToolCalls = 0;
  private failedToolCalls = 0;
  private modelTurns = 0;
  private noProgressTurns = 0;
  private meaningfulProgressCounter = 0;
  private turnStartProgressCounter = 0;
  private turnActive = false;
  private lastMeaningfulProgressAt: number;
  private todoPlanObservedValue = false;
  private todoCounts = { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
  private todoItems?: AgentChildRunControlSnapshot["todo"]["items"];
  private limitReason?: AgentChildRunControlSnapshot["budget"]["limitReason"];
  private currentModelText = "";
  private checkpoint?: AgentChildRunCheckpoint;
  private grantedExtensionMs = 0;
  private softDeadlineAt: number;
  private hardDeadlineAt?: number;
  private lastSnapshotAt?: number;

  constructor(private readonly options: AgentChildRunActivityTrackerOptions) {
    this.clock = options.clock ?? SystemActivityClock;
    const initial = options.initialSnapshot;
    this.lastActivityAt = initial ? readTimestamp(initial.lastActivityAt, options.startedAt) : options.startedAt;
    this.lastModelOutputAt = initial?.lastModelOutputAt
      ? readTimestamp(initial.lastModelOutputAt, this.lastActivityAt)
      : undefined;
    this.modelOutputCharacters = initial?.modelOutputCharacters ?? 0;
    this.assistantTurns = initial?.assistantTurns ?? 0;
    this.plannedToolCalls = initial?.toolCalls.planned ?? 0;
    this.startedToolCalls = initial?.toolCalls.started ?? 0;
    this.completedToolCalls = initial?.toolCalls.completed ?? 0;
    this.failedToolCalls = initial?.toolCalls.failed ?? 0;
    this.artifactUris = new Set(initial?.artifactUris ?? []);
    this.softDeadlineAt = initial
      ? readTimestamp(initial.deadline.softDeadlineAt, options.startedAt + options.policy.softTimeoutMs)
      : options.startedAt + options.policy.softTimeoutMs;
    this.grantedExtensionMs = initial?.deadline.grantedExtensionMs ?? 0;
    this.hardDeadlineAt = initial?.deadline.hardDeadlineAt
      ? readTimestamp(initial.deadline.hardDeadlineAt, this.softDeadlineAt + options.policy.wrapUpTimeoutMs)
      : undefined;
    this.lastMeaningfulProgressAt = initial?.control?.budget.lastMeaningfulProgressAt
      ? readTimestamp(initial.control.budget.lastMeaningfulProgressAt, this.lastActivityAt)
      : (this.lastModelOutputAt ?? this.lastActivityAt);
    if (initial?.control) {
      this.modelTurns = initial.control.budget.modelTurns;
      this.noProgressTurns = initial.control.budget.noProgressTurns;
      this.todoPlanObservedValue = initial.control.todo.planObserved;
      this.todoCounts = { ...initial.control.todo.counts };
      this.todoItems = initial.control.todo.items ? [...initial.control.todo.items] : undefined;
      this.limitReason = initial.control.budget.limitReason;
    }
  }

  observe(event: AgentDomainEvent): void {
    const now = this.clock.now();
    switch (event.kind) {
      case AgentEventKinds.ModelStarted:
        this.currentModelText = "";
        this.modelTurns += 1;
        this.turnStartProgressCounter = this.meaningfulProgressCounter;
        this.turnActive = true;
        this.recordActivity(now);
        return;
      case AgentEventKinds.ModelDelta:
        this.currentModelText += event.data.text;
        this.modelOutputCharacters += event.data.text.length;
        this.lastModelOutputAt = now;
        this.checkpoint = this.modelCheckpoint(now, false);
        if (event.data.text.trim()) this.recordMeaningfulProgress(now);
        this.recordActivity(now);
        return;
      case AgentEventKinds.ModelCompleted:
        if (event.data.text.trim()) this.currentModelText = event.data.text;
        if (this.currentModelText.trim()) this.checkpoint = this.modelCheckpoint(now, true);
        if (this.currentModelText.trim()) this.recordMeaningfulProgress(now);
        this.finishModelTurn();
        this.recordActivity(now);
        return;
      case AgentEventKinds.AssistantMessageCreated:
        this.assistantTurns += 1;
        if (event.data.content.trim()) {
          this.checkpoint = {
            version: 1,
            capturedAt: this.clock.timestamp(now),
            source: AgentChildRunCheckpointSources.AssistantMessage,
            content: event.data.content,
            complete: event.data.terminal,
          };
          this.recordMeaningfulProgress(now);
        }
        this.recordActivity(now);
        return;
      case AgentEventKinds.ToolCallsPlanned:
        this.plannedToolCalls += event.data.toolCount;
        this.recordActivity(now);
        return;
      case AgentEventKinds.ToolCallStarted:
        this.startedToolCalls += 1;
        this.activeTools.set(event.data.callId, event.data.toolName);
        this.recordActivity(now);
        return;
      case AgentEventKinds.ToolCallOutput:
      case AgentEventKinds.ToolCallProgress:
        this.recordActivity(now);
        return;
      case AgentEventKinds.ToolCallCompleted:
        this.completedToolCalls += 1;
        this.activeTools.delete(event.data.callId);
        if (event.data.presentation?.artifactUri) this.artifactUris.add(event.data.presentation.artifactUri);
        this.recordMeaningfulProgress(now);
        this.recordActivity(now);
        return;
      case AgentEventKinds.ToolCallFailed:
        this.failedToolCalls += 1;
        this.activeTools.delete(event.data.callId);
        this.recordActivity(now);
        return;
      case AgentEventKinds.TodoListWritten:
        this.todoCounts = { ...event.data.snapshot.counts };
        this.todoItems = projectChildRunTodoItems(event.data.snapshot) ?? this.todoItems;
        if (event.data.source === AgentTodoWriteSources.Model) {
          this.todoPlanObservedValue = true;
          this.recordMeaningfulProgress(now);
        }
        this.recordActivity(now);
        return;
      default:
        return;
    }
  }

  hasRecentModelOutput(now = this.clock.now()): boolean {
    return (
      this.lastModelOutputAt !== undefined &&
      now - this.lastModelOutputAt <= this.options.policy.activityExtension.recentActivityWindowMs
    );
  }

  /** Activity is evidence that the child is making progress, not only emitting prose. */
  hasRecentActivity(now = this.clock.now()): boolean {
    return now - this.lastActivityAt <= this.options.policy.activityExtension.recentActivityWindowMs;
  }

  /** True only when a model output, successful operation, or model Todo write changed state. */
  hasRecentMeaningfulProgress(now = this.clock.now()): boolean {
    return now - this.lastMeaningfulProgressAt <= this.options.policy.activityExtension.recentActivityWindowMs;
  }

  shouldRequestWrapUp(now = this.clock.now()): boolean {
    const control = this.options.control;
    if (!control) return false;
    if (this.modelTurns >= control.budget.maxModelTurns) {
      this.limitReason = "model_turn_budget";
      return true;
    }
    if (this.startedToolCalls >= control.budget.maxToolCalls) {
      this.limitReason = "tool_call_budget";
      return true;
    }
    if (this.noProgressTurns >= control.budget.noProgressTurns) {
      this.limitReason = "no_progress";
      return true;
    }
    if (this.modelTurns > 0 && now - this.lastMeaningfulProgressAt >= control.budget.noProgressTimeoutMs) {
      this.limitReason = "no_progress";
      return true;
    }
    return false;
  }

  todoPlanObserved(): boolean {
    return this.todoPlanObservedValue;
  }

  setTodoState(state: {
    readonly planObserved: boolean;
    readonly counts: AgentChildRunControlSnapshot["todo"]["counts"];
    readonly items?: AgentChildRunControlSnapshot["todo"]["items"];
  }): void {
    this.todoPlanObservedValue = state.planObserved;
    this.todoCounts = { ...state.counts };
    if (state.items) this.todoItems = [...state.items];
  }

  extendDeadline(extensionMs: number): void {
    this.grantedExtensionMs += extensionMs;
    this.softDeadlineAt += extensionMs;
    this.recordActivity(this.clock.now());
  }

  enterWrapUp(hardDeadlineAt: number): void {
    this.hardDeadlineAt = hardDeadlineAt;
    this.recordActivity(this.clock.now());
  }

  deadlineState(): { readonly softDeadlineAt: number; readonly grantedExtensionMs: number } {
    return { softDeadlineAt: this.softDeadlineAt, grantedExtensionMs: this.grantedExtensionMs };
  }

  shouldPersistSnapshot(force = false): boolean {
    const now = this.clock.now();
    return (
      force || this.lastSnapshotAt === undefined || now - this.lastSnapshotAt >= this.options.policy.snapshotIntervalMs
    );
  }

  snapshot(): AgentChildRunSnapshot {
    const capturedAt = this.clock.now();
    this.lastSnapshotAt = capturedAt;
    return {
      version: 1,
      capturedAt: this.clock.timestamp(capturedAt),
      lastActivityAt: this.clock.timestamp(this.lastActivityAt),
      ...(this.lastModelOutputAt !== undefined
        ? { lastModelOutputAt: this.clock.timestamp(this.lastModelOutputAt) }
        : {}),
      modelOutputCharacters: this.modelOutputCharacters,
      assistantTurns: this.assistantTurns,
      toolCalls: {
        planned: this.plannedToolCalls,
        started: this.startedToolCalls,
        completed: this.completedToolCalls,
        failed: this.failedToolCalls,
      },
      activeTools: [...new Set(this.activeTools.values())].sort(),
      artifactUris: [...this.artifactUris].sort(),
      ...(this.options.control ? { control: this.controlSnapshot() } : {}),
      deadline: {
        softDeadlineAt: this.clock.timestamp(this.softDeadlineAt),
        grantedExtensionMs: this.grantedExtensionMs,
        ...(this.hardDeadlineAt !== undefined ? { hardDeadlineAt: this.clock.timestamp(this.hardDeadlineAt) } : {}),
      },
    };
  }

  latestCheckpoint(): AgentChildRunCheckpoint | undefined {
    return this.checkpoint ? { ...this.checkpoint } : undefined;
  }

  supervisorCheckpoint(content: string): AgentChildRunCheckpoint {
    const capturedAt = this.clock.now();
    return {
      version: 1,
      capturedAt: this.clock.timestamp(capturedAt),
      source: AgentChildRunCheckpointSources.SupervisorWait,
      ...(content.trim() ? { content } : {}),
      complete: true,
    };
  }

  private modelCheckpoint(capturedAt: number, complete: boolean): AgentChildRunCheckpoint {
    return {
      version: 1,
      capturedAt: this.clock.timestamp(capturedAt),
      source: AgentChildRunCheckpointSources.ModelStream,
      ...(this.currentModelText.trim() ? { content: this.currentModelText } : {}),
      complete,
    };
  }

  private recordActivity(at: number): void {
    this.lastActivityAt = Math.max(this.lastActivityAt, at);
  }

  private recordMeaningfulProgress(at: number): void {
    this.meaningfulProgressCounter += 1;
    this.lastMeaningfulProgressAt = Math.max(this.lastMeaningfulProgressAt, at);
    this.noProgressTurns = 0;
  }

  private finishModelTurn(): void {
    if (!this.turnActive) return;
    if (this.meaningfulProgressCounter === this.turnStartProgressCounter) this.noProgressTurns += 1;
    this.turnActive = false;
  }

  private controlSnapshot(): AgentChildRunControlSnapshot {
    return {
      todo: {
        planObserved: this.todoPlanObservedValue,
        counts: { ...this.todoCounts },
        ...(this.todoItems ? { items: [...this.todoItems] } : {}),
      },
      budget: {
        modelTurns: this.modelTurns,
        toolCalls: this.startedToolCalls,
        noProgressTurns: this.noProgressTurns,
        lastMeaningfulProgressAt: this.clock.timestamp(this.lastMeaningfulProgressAt),
        ...(this.limitReason ? { limitReason: this.limitReason } : {}),
      },
    };
  }
}

function readTimestamp(value: string, fallback: number): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
