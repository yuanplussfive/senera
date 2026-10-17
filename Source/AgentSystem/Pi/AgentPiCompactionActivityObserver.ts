import { AgentRunActivityReporter, type AgentRunActivityHandle } from "../Events/AgentRunActivityReporter.js";
import { AgentRunActivities } from "../Events/AgentRunEventTypes.js";
import type { AgentPiCompactionLifecycleEvent } from "./AgentPiSessionEvents.js";

/** Projects Pi's actual compaction lifecycle into the active Senera run. */
export class AgentPiCompactionActivityObserver {
  private active?: AgentRunActivityHandle;

  constructor(private readonly reporter: AgentRunActivityReporter) {}

  async observe(event: AgentPiCompactionLifecycleEvent): Promise<void> {
    if (event.type === "compaction_start") {
      await this.active?.fail();
      this.active = await this.reporter.start(AgentRunActivities.CompactingContext);
      return;
    }

    const active = this.active;
    this.active = undefined;
    if (!active) return;
    if (event.aborted || event.errorMessage || event.result === undefined) await active.fail();
    else await active.complete();
  }
}
