import { describe, expect, test } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentRunActivityReporter } from "../../../Source/AgentSystem/Events/AgentRunActivityReporter.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import { AgentPiCompactionActivityObserver } from "../../../Source/AgentSystem/Pi/AgentPiCompactionActivityObserver.js";

describe("Pi compaction activity", () => {
  test("projects Pi compaction start and completion into the current run", async () => {
    const events: AgentDomainEvent[] = [];
    const observer = new AgentPiCompactionActivityObserver(
      new AgentRunActivityReporter({
        sessionId: "session-compaction",
        requestId: "request-compaction",
        step: 1,
        onEvent: (event) => {
          events.push(event);
        },
      }),
    );

    await observer.observe({ type: "compaction_start", reason: "threshold" });
    await observer.observe({
      type: "compaction_end",
      reason: "threshold",
      result: {
        summary: "Compacted conversation",
        firstKeptEntryId: "entry-recent",
        tokensBefore: 10_000,
      },
      aborted: false,
      willRetry: false,
    });

    const activities = events.filter((event) => event.kind === AgentEventKinds.RunActivityChanged);
    expect(activities.map((event) => ({ activity: event.data.activity, state: event.data.state }))).toEqual([
      { activity: AgentRunActivities.CompactingContext, state: AgentRunActivityStates.Started },
      { activity: AgentRunActivities.CompactingContext, state: AgentRunActivityStates.Completed },
    ]);
    expect(activities[1]?.data.durationMs).toBeGreaterThanOrEqual(0);
  });
});
