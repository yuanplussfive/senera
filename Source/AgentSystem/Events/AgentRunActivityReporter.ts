import { AsyncLocalStorage } from "node:async_hooks";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentEventKinds, emitAgentEvent, type AgentEventSink } from "./AgentEvent.js";
import { AgentRunActivityStates, type AgentRunActivity, type AgentRunActivityState } from "./AgentRunEventTypes.js";
import { SystemAgentLifecycleClock, type AgentLifecycleClock } from "./AgentLifecycleClock.js";

export interface AgentRunActivityReporterOptions {
  readonly sessionId?: string;
  readonly requestId: string;
  readonly step?: number;
  readonly onEvent?: AgentEventSink;
  readonly clock?: AgentRunActivityClock;
}

export type AgentRunActivityClock = AgentLifecycleClock;

export interface AgentRunActivityHandle {
  readonly id: string;
  readonly activity: AgentRunActivity;
  complete(): Promise<void>;
  fail(): Promise<void>;
}

export class AgentRunActivityReporter {
  private readonly activityContext = new AsyncLocalStorage<string>();
  private readonly clock: AgentRunActivityClock;

  constructor(private readonly options: AgentRunActivityReporterOptions) {
    this.clock = options.clock ?? SystemAgentLifecycleClock;
  }

  async track<T>(activity: AgentRunActivity, run: () => T | Promise<T>): Promise<T> {
    const handle = await this.start(activity);
    return this.activityContext.run(handle.id, async () => {
      try {
        const result = await run();
        await handle.complete();
        return result;
      } catch (error) {
        await handle.fail();
        throw error;
      }
    });
  }

  async start(activity: AgentRunActivity): Promise<AgentRunActivityHandle> {
    const id = createOpaqueId("activity");
    const parentActivityId = this.activityContext.getStore();
    const startedAtEpoch = this.clock.now();
    const startedAtMonotonic = this.clock.monotonicNow();
    const startedAt = this.clock.timestamp(startedAtEpoch);
    let terminal = false;
    await this.emit(id, parentActivityId, activity, AgentRunActivityStates.Started, startedAt);

    const finish = async (state: Exclude<AgentRunActivityState, "started">): Promise<void> => {
      if (terminal) return;
      terminal = true;
      await this.emit(
        id,
        parentActivityId,
        activity,
        state,
        startedAt,
        Math.max(0, Math.round(this.clock.monotonicNow() - startedAtMonotonic)),
      );
    };

    return {
      id,
      activity,
      complete: () => finish(AgentRunActivityStates.Completed),
      fail: () => finish(AgentRunActivityStates.Failed),
    };
  }

  private async emit(
    activityId: string,
    parentActivityId: string | undefined,
    activity: AgentRunActivity,
    state: AgentRunActivityState,
    startedAt: string,
    durationMs?: number,
  ): Promise<void> {
    await emitAgentEvent(this.options.onEvent, {
      kind: AgentEventKinds.RunActivityChanged,
      context: {
        sessionId: this.options.sessionId,
        requestId: this.options.requestId,
        step: this.options.step,
      },
      data: {
        activityId,
        ...(parentActivityId === undefined ? {} : { parentActivityId }),
        activity,
        state,
        startedAt,
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    });
  }
}
