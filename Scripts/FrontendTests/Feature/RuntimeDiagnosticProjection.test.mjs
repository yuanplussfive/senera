import { expect, test } from "vitest";
import { EventKinds, EventSpecs } from "../../../Frontend/src/api/generatedEventCatalog.ts";
import { projectRuntimeDiagnostic } from "../../../Frontend/src/features/observability/runtimeDiagnosticProjection.ts";

test("projects only explicit activity and tool lifecycle intervals", () => {
  const model = projectRuntimeDiagnostic(
    [
      projected(EventKinds.RunActivityChanged, 1, {
        activityId: "activity-1",
        activity: "running_agent_turn",
        state: "started",
        startedAt: "2026-08-04T00:00:00.100Z",
      }),
      projected(EventKinds.RunActivityChanged, 2, {
        activityId: "activity-1",
        activity: "running_agent_turn",
        state: "completed",
        startedAt: "2026-08-04T00:00:00.100Z",
        durationMs: 900,
      }),
      projected(EventKinds.ToolCallStarted, 3, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        origin: { kind: "system", name: "Workspace Tools", capability: "workspace.content.search" },
        startedAt: "2026-08-04T00:00:00.250Z",
        arguments: { pattern: "agent" },
      }),
      projected(EventKinds.ToolCallCompleted, 4, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        origin: { kind: "system", name: "Workspace Tools", capability: "workspace.content.search" },
        startedAt: "2026-08-04T00:00:00.250Z",
        durationMs: 350,
      }),
      commandWithRequestId(5, "request-after-run"),
    ],
    { nowEpoch: Date.parse("2026-08-04T00:00:01.500Z") },
  );

  expect(model.requestId).toBe("request-1");
  expect(model.spans).toMatchObject([
    {
      id: "activity:activity-1",
      lane: "model",
      status: "completed",
      durationMs: 900,
    },
    {
      id: "tool:call-1",
      lane: "tools",
      status: "completed",
      durationMs: 350,
      toolOrigin: { kind: "system", capability: "workspace.content.search" },
      toolArguments: { pattern: "agent" },
    },
  ]);
});

test("projects the Pi context capacity from the runtime status event", () => {
  const model = projectRuntimeDiagnostic([
    projected(EventKinds.SessionRuntimeStatus, 1, {
      runtime: {
        stats: {
          userMessages: 1,
          assistantMessages: 1,
          toolCalls: 2,
          toolResults: 2,
          totalMessages: 2,
          tokens: {
            input: 12000,
            output: 5000,
            cacheRead: 3000,
            cacheWrite: 1000,
            total: 21000,
          },
          cost: 0.0042,
        },
        contextUsage: {
          tokens: 165700,
          contextWindow: 1_000_000,
          percent: 16.57,
        },
      },
    }),
  ]);

  expect(model.contextUsage).toEqual({
    tokens: 165700,
    contextWindow: 1_000_000,
    percent: 16.57,
  });
  expect(model.sessionUsage).toEqual({
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 2,
    toolResults: 2,
    totalMessages: 2,
    tokens: {
      input: 12000,
      output: 5000,
      cacheRead: 3000,
      cacheWrite: 1000,
      total: 21000,
    },
    cost: 0.0042,
  });
});

test("scopes live usage and diagnostic spans to the active session", () => {
  const model = projectRuntimeDiagnostic(
    [
      projected(
        EventKinds.SessionRuntimeStatus,
        1,
        {
          runtime: {
            stats: { totalMessages: 7, tokens: { total: 700 } },
            contextUsage: { tokens: 700, contextWindow: 10000, percent: 7 },
          },
        },
        "other-session",
      ),
      projected(
        EventKinds.SessionRuntimeStatus,
        2,
        {
          runtime: {
            stats: { totalMessages: 2, tokens: { total: 200 } },
            contextUsage: { tokens: 200, contextWindow: 10000, percent: 2 },
          },
        },
        "active-session",
      ),
    ],
    { activeSessionId: "active-session" },
  );

  expect(model.sessionId).toBe("active-session");
  expect(model.contextUsage).toMatchObject({ tokens: 200, percent: 2 });
  expect(model.sessionUsage).toMatchObject({ totalMessages: 2, tokens: { total: 200 } });
});

test("rejects incomplete tool lifecycle data instead of inferring a duration", () => {
  const model = projectRuntimeDiagnostic(
    [
      projected(EventKinds.ToolCallStarted, 1, {
        index: 0,
        toolName: "shell_command",
        callId: "call-incomplete",
      }),
      projected(EventKinds.ToolCallCompleted, 2, {
        index: 0,
        toolName: "shell_command",
        callId: "call-incomplete",
      }),
    ],
    { nowEpoch: Date.parse("2026-08-04T00:00:05.000Z") },
  );

  expect(model.spans).toEqual([]);
});

test("keeps parallel tools in separate waterfall tracks", () => {
  const model = projectRuntimeDiagnostic([
    projected(EventKinds.ToolCallStarted, 1, {
      index: 0,
      toolName: "search",
      callId: "call-a",
      startedAt: "2026-08-04T00:00:00.000Z",
    }),
    projected(EventKinds.ToolCallStarted, 2, {
      index: 1,
      toolName: "read",
      callId: "call-b",
      startedAt: "2026-08-04T00:00:00.000Z",
    }),
  ]);

  expect(model.lanes.find((lane) => lane.lane === "tools")).toMatchObject({ trackCount: 2 });
  expect(model.lanes.find((lane) => lane.lane === "tools")?.spans.map((span) => span.track)).toEqual([0, 1]);
});

test("does not let an undeclared payload become a diagnostic span", () => {
  const model = projectRuntimeDiagnostic([
    projected(EventKinds.ToolCallProgress, 1, {
      callId: "call-not-a-lifecycle",
      toolName: "search",
      startedAt: "2026-08-04T00:00:00.000Z",
      durationMs: 500,
      state: "completed",
    }),
  ]);

  expect(model.spans).toEqual([]);
});

test("does not overwrite a verified start with a mismatched terminal identity", () => {
  const model = projectRuntimeDiagnostic([
    projected(EventKinds.ToolCallStarted, 1, {
      index: 0,
      toolName: "search",
      callId: "call-identity",
      startedAt: "2026-08-04T00:00:00.000Z",
    }),
    projected(EventKinds.ToolCallCompleted, 2, {
      index: 0,
      toolName: "read",
      callId: "call-identity",
      startedAt: "2026-08-04T00:00:00.000Z",
      durationMs: 500,
    }),
  ]);

  expect(model.spans).toMatchObject([
    {
      id: "tool:call-identity",
      toolName: "search",
      status: "running",
      durationMs: undefined,
    },
  ]);
});

function projected(kind, sequence, data, sessionId = "session-1") {
  return {
    id: `journal-${sequence}`,
    localSequence: sequence,
    connectionId: "ws-1",
    observedAt: "2026-08-04T00:00:00.000Z",
    observedAtEpoch: Date.parse("2026-08-04T00:00:00.000Z"),
    direction: "inbound",
    stage: "projected",
    kind,
    layer: EventSpecs[kind].layer,
    phase: EventSpecs[kind].phase,
    sequence,
    sessionId,
    requestId: "request-1",
    step: 1,
    retainedByteLength: 128,
    projection: { data },
    projectionOmitted: false,
  };
}

function commandWithRequestId(sequence, requestId) {
  return {
    id: `journal-${sequence}`,
    localSequence: sequence,
    connectionId: "ws-1",
    observedAt: "2026-08-04T00:00:02.000Z",
    observedAtEpoch: Date.parse("2026-08-04T00:00:02.000Z"),
    direction: "outbound",
    stage: "command",
    kind: "session.message",
    requestId,
    retainedByteLength: 64,
    projectionOmitted: false,
  };
}
