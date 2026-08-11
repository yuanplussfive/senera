import { describe, expect, test } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import {
  AgentEventObservationSpecTable,
  AgentEventObservationRetentions,
} from "../../../Source/AgentSystem/Events/AgentEventObservationCatalog.js";
import { AgentRunActivities, AgentRunActivityStates } from "../../../Source/AgentSystem/Events/AgentRunEventTypes.js";
import {
  AgentRunActivityReporter,
  type AgentRunActivityClock,
} from "../../../Source/AgentSystem/Events/AgentRunActivityReporter.js";
import { AgentLoopToolEventFactory } from "../../../Source/AgentSystem/Loop/AgentLoopToolEventFactory.js";

describe("run activity observability", () => {
  test("emits hierarchical activities with stable start times and terminal durations", async () => {
    const events: AgentDomainEvent[] = [];
    const clock = new TestRunActivityClock(1_000);
    const reporter = new AgentRunActivityReporter({
      requestId: "request-1",
      sessionId: "session-1",
      step: 2,
      clock,
      onEvent: (event) => {
        events.push(event);
      },
    });

    await reporter.track(AgentRunActivities.RunningAgentTurn, async () => {
      clock.advance(10);
      const response = await reporter.start(AgentRunActivities.GeneratingResponse);
      clock.advance(15);
      await response.complete();
      clock.advance(5);
    });

    const activities = events.filter((event) => event.kind === AgentEventKinds.RunActivityChanged);
    const parentId = activities[0]?.data.activityId;
    const childId = activities[1]?.data.activityId;
    expect(parentId).toBeTypeOf("string");
    expect(childId).toBeTypeOf("string");
    expect(activities.map((event) => event.data)).toEqual([
      {
        activityId: parentId,
        activity: AgentRunActivities.RunningAgentTurn,
        state: AgentRunActivityStates.Started,
        startedAt: "1970-01-01T00:00:01.000Z",
      },
      {
        activityId: childId,
        parentActivityId: parentId,
        activity: AgentRunActivities.GeneratingResponse,
        state: AgentRunActivityStates.Started,
        startedAt: "1970-01-01T00:00:01.010Z",
      },
      {
        activityId: childId,
        parentActivityId: parentId,
        activity: AgentRunActivities.GeneratingResponse,
        state: AgentRunActivityStates.Completed,
        startedAt: "1970-01-01T00:00:01.010Z",
        durationMs: 15,
      },
      {
        activityId: parentId,
        activity: AgentRunActivities.RunningAgentTurn,
        state: AgentRunActivityStates.Completed,
        startedAt: "1970-01-01T00:00:01.000Z",
        durationMs: 30,
      },
    ]);
  });

  test("keeps concurrent child activities as siblings under their async parent", async () => {
    const events: AgentDomainEvent[] = [];
    const reporter = new AgentRunActivityReporter({
      requestId: "request-concurrent",
      onEvent: (event) => {
        events.push(event);
      },
    });

    await reporter.track(AgentRunActivities.RunningAgentTurn, async () => {
      const first = await reporter.start(AgentRunActivities.GeneratingResponse);
      const second = await reporter.start(AgentRunActivities.FinalizingResponse);
      await Promise.all([first.complete(), second.complete()]);
    });

    const activities = events.filter((event) => event.kind === AgentEventKinds.RunActivityChanged);
    const started = activities.filter((event) => event.data.state === AgentRunActivityStates.Started);
    const parentId = started.find((event) => event.data.activity === AgentRunActivities.RunningAgentTurn)?.data
      .activityId;
    expect(parentId).toBeTypeOf("string");
    expect(
      started
        .filter((event) => event.data.activity !== AgentRunActivities.RunningAgentTurn)
        .map((event) => event.data.parentActivityId),
    ).toEqual([parentId, parentId]);
  });

  test("declares safe browser retention for every event kind", () => {
    expect(Object.keys(AgentEventObservationSpecTable).sort()).toEqual(Object.values(AgentEventKinds).sort());
    expect(AgentEventObservationSpecTable[AgentEventKinds.RunStarted]).toEqual({
      retention: AgentEventObservationRetentions.Metadata,
      projectionPointers: [],
    });
    expect(AgentEventObservationSpecTable[AgentEventKinds.ModelDelta].projectionPointers).not.toContain("/data/text");
    expect(AgentEventObservationSpecTable[AgentEventKinds.ToolCallOutput].projectionPointers).not.toContain(
      "/data/text",
    );
    expect(AgentEventObservationSpecTable[AgentEventKinds.ConfigSnapshot].projectionPointers).not.toContain(
      "/data/config",
    );
  });

  test("keeps tool lifecycle timing explicit for diagnostic consumers", () => {
    const factory = new AgentLoopToolEventFactory();
    const started = factory.toolCallStarted("request-tool", 1, 0, "search", "call-tool", {
      startedAt: "2026-08-04T00:00:00.000Z",
    });
    const completed = factory.toolCallCompleted("request-tool", 1, 0, "search", "call-tool", undefined, {
      startedAt: "2026-08-04T00:00:00.000Z",
      durationMs: 42,
    });

    expect(started.data).toMatchObject({ callId: "call-tool", startedAt: "2026-08-04T00:00:00.000Z" });
    expect(completed.data).toMatchObject({
      callId: "call-tool",
      startedAt: "2026-08-04T00:00:00.000Z",
      durationMs: 42,
    });
  });

  test("declares diagnostic field projection through the generated event contract", () => {
    const lifecycleKinds = [
      AgentEventKinds.RunActivityChanged,
      AgentEventKinds.ToolCallStarted,
      AgentEventKinds.ToolCallCompleted,
      AgentEventKinds.ToolCallFailed,
    ];

    for (const kind of lifecycleKinds) {
      const observation = AgentEventObservationSpecTable[kind];
      expect(observation.diagnostic).toBeDefined();
      expect(observation.diagnostic?.idPointer).toBeTruthy();
      expect(observation.diagnostic?.labelPointer).toBeTruthy();
      expect(observation.projectionPointers).toContain(observation.diagnostic?.startedAtPointer);
      expect(observation.projectionPointers).toContain(observation.diagnostic?.durationMsPointer);
    }
  });
});

class TestRunActivityClock implements AgentRunActivityClock {
  constructor(private epochMilliseconds: number) {}

  now(): number {
    return this.epochMilliseconds;
  }

  timestamp(epochMilliseconds: number): string {
    return new Date(epochMilliseconds).toISOString();
  }

  monotonicNow(): number {
    return this.epochMilliseconds;
  }

  advance(milliseconds: number): void {
    this.epochMilliseconds += milliseconds;
  }
}
