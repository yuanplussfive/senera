import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentEventKinds, emitAgentEvent, type AgentEventSink } from "./AgentEvent.js";
import { AgentRunActivityStates, type AgentRunActivity, type AgentRunActivityState } from "./AgentRunEventTypes.js";

export interface AgentRunActivityReporterOptions {
  readonly sessionId?: string;
  readonly requestId: string;
  readonly step?: number;
  readonly onEvent?: AgentEventSink;
}

export interface AgentRunActivityHandle {
  readonly id: string;
  readonly activity: AgentRunActivity;
  complete(): Promise<void>;
  fail(): Promise<void>;
}

export class AgentRunActivityReporter {
  constructor(private readonly options: AgentRunActivityReporterOptions) {}

  async track<T>(activity: AgentRunActivity, run: () => T | Promise<T>): Promise<T> {
    const handle = await this.start(activity);
    try {
      const result = await run();
      await handle.complete();
      return result;
    } catch (error) {
      await handle.fail();
      throw error;
    }
  }

  async start(activity: AgentRunActivity): Promise<AgentRunActivityHandle> {
    const id = createOpaqueId("activity");
    let terminal = false;
    await this.emit(id, activity, AgentRunActivityStates.Started);

    const finish = async (state: Exclude<AgentRunActivityState, "started">): Promise<void> => {
      if (terminal) return;
      terminal = true;
      await this.emit(id, activity, state);
    };

    return {
      id,
      activity,
      complete: () => finish(AgentRunActivityStates.Completed),
      fail: () => finish(AgentRunActivityStates.Failed),
    };
  }

  private async emit(activityId: string, activity: AgentRunActivity, state: AgentRunActivityState): Promise<void> {
    await emitAgentEvent(this.options.onEvent, {
      kind: AgentEventKinds.RunActivityChanged,
      context: {
        sessionId: this.options.sessionId,
        requestId: this.options.requestId,
        step: this.options.step,
      },
      data: {
        activityId,
        activity,
        state,
      },
    });
  }
}
