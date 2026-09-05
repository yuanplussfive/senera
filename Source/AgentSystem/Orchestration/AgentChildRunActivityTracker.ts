import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import {
  AgentChildRunCheckpointSources,
  type AgentChildRunCheckpoint,
  type AgentChildRunDeadlinePolicy,
  type AgentChildRunSnapshot,
} from "./AgentChildRunTypes.js";

export interface AgentChildRunActivityClock {
  readonly now: () => number;
  readonly timestamp: (epochMilliseconds: number) => string;
}

export interface AgentChildRunActivityTrackerOptions {
  readonly startedAt: number;
  readonly policy: AgentChildRunDeadlinePolicy;
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
  private currentModelText = "";
  private checkpoint?: AgentChildRunCheckpoint;
  private grantedExtensionMs = 0;
  private softDeadlineAt: number;
  private hardDeadlineAt?: number;
  private lastSnapshotAt?: number;

  constructor(private readonly options: AgentChildRunActivityTrackerOptions) {
    this.clock = options.clock ?? SystemActivityClock;
    this.lastActivityAt = options.startedAt;
    this.softDeadlineAt = options.startedAt + options.policy.softTimeoutMs;
  }

  observe(event: AgentDomainEvent): void {
    const now = this.clock.now();
    switch (event.kind) {
      case AgentEventKinds.ModelStarted:
        this.currentModelText = "";
        this.recordActivity(now);
        return;
      case AgentEventKinds.ModelDelta:
        this.currentModelText += event.data.text;
        this.modelOutputCharacters += event.data.text.length;
        this.lastModelOutputAt = now;
        this.checkpoint = this.modelCheckpoint(now, false);
        this.recordActivity(now);
        return;
      case AgentEventKinds.ModelCompleted:
        if (event.data.text.trim()) this.currentModelText = event.data.text;
        if (this.currentModelText.trim()) this.checkpoint = this.modelCheckpoint(now, true);
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
        this.recordActivity(now);
        return;
      case AgentEventKinds.ToolCallFailed:
        this.failedToolCalls += 1;
        this.activeTools.delete(event.data.callId);
        this.recordActivity(now);
        return;
      default:
        return;
    }
  }

  hasRecentModelOutput(now = this.clock.now()): boolean {
    return this.hasRecentActivity(now);
  }

  /** Activity is evidence that the child is making progress, not only emitting prose. */
  hasRecentActivity(now = this.clock.now()): boolean {
    return now - this.lastActivityAt <= this.options.policy.activityExtension.recentActivityWindowMs;
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
}
