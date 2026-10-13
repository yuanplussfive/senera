import { beforeEach, expect, test } from "vitest";
import { EventKinds, EventSpecs } from "../../../Frontend/src/api/generatedEventCatalog.ts";
import {
  EventJournalProjectionMaxBytes,
  projectEventForJournal,
  readJsonPointer,
} from "../../../Frontend/src/features/observability/eventJournalProjection.ts";
import {
  EventJournalPolicy,
  useEventJournalStore,
} from "../../../Frontend/src/features/observability/eventJournalStore.ts";
import { installEventJournalRecorder } from "../../../Frontend/src/features/observability/eventJournalRecorder.ts";
import { publishAgentTransportObservation } from "../../../Frontend/src/api/agentTransportObserver.ts";

beforeEach(() => {
  useEventJournalStore.setState({
    records: [],
    totalBytes: 0,
    recording: true,
    wireCapture: false,
    viewPausedAt: undefined,
    selectedId: undefined,
  });
});

test("event journal projection retains only declared fields and excludes sensitive bodies", () => {
  expect(projectEventForJournal(event(EventKinds.RunStarted, { input: "private user input" }))).toEqual({
    byteLength: 0,
    omitted: false,
  });

  const activity = projectEventForJournal(
    event(EventKinds.RunActivityChanged, {
      activityId: "activity-1",
      parentActivityId: "activity-parent",
      activity: "running_agent_turn",
      state: "completed",
      startedAt: "2026-08-04T00:00:00.000Z",
      durationMs: 125,
      privateDetail: "not declared",
    }),
  );
  expect(activity.value).toEqual({
    data: {
      activityId: "activity-1",
      parentActivityId: "activity-parent",
      activity: "running_agent_turn",
      state: "completed",
      startedAt: "2026-08-04T00:00:00.000Z",
      durationMs: 125,
    },
  });
  expect(activity.summary).toBe("activity=running_agent_turn  state=completed  durationMs=125");

  const output = projectEventForJournal(
    event(EventKinds.ToolCallOutput, {
      toolName: "shell_command",
      callId: "call-1",
      text: "secret terminal output",
      byteLength: 22,
      totalBytes: 22,
    }),
  );
  expect(output.value.data).not.toHaveProperty("text");
  expect(output.value.data).toMatchObject({ toolName: "shell_command", byteLength: 22, totalBytes: 22 });
});

test("event journal preserves native memory and strips internal delivery state", () => {
  const projected = projectEventForJournal(
    event(EventKinds.ContinuitySnapshot, {
      ...{
        enabled: true,
        periodDigests: [],
        eventCandidates: [
          {
            id: "1",
            uri: "memos:1",
            revision: "v1",
            type: "preference",
            summary: "先给结论。",
            occurredAt: "2026-08-22T08:00:00Z",
            score: 0.91,
            matchedBy: ["memos"],
          },
        ],
        selection: {
          digests: { available: 0, matched: 0, selected: 0 },
          events: { available: 1, matched: 1, selected: 1 },
          usedTokens: 24,
          maxTokens: 2048,
        },
      },
      deliveryEpoch: 7,
    }),
  );
  expect(projected.value?.data).toMatchObject({ eventCandidates: [{ uri: "memos:1" }], selection: { usedTokens: 24 } });
  expect(projected.value?.data).not.toHaveProperty("deliveryEpoch");
});

test("event journal gives orchestration events contract-driven semantic summaries", () => {
  expect(
    projectEventForJournal(
      event(EventKinds.ChildRunStarted, {
        childRunId: "child-1",
        childSessionId: "child-session-1",
        agentName: "reviewer",
        status: "running",
        contextMode: "fork",
      }),
    ).summary,
  ).toBe("agent=reviewer  status=running  context=fork");

  expect(
    projectEventForJournal(
      event(EventKinds.ScheduledTaskChanged, {
        taskId: "task-1",
        operation: "created",
        enabled: false,
      }),
    ).summary,
  ).toBe("task=task-1  operation=created  enabled=false");

  expect(
    projectEventForJournal(
      event(EventKinds.WorkflowSnapshotUpdated, {
        workflowId: "workflow-1",
        status: "running",
        definitionDigest: "digest-1",
        nodes: [{ nodeId: "review", status: "running" }],
      }),
    ).summary,
  ).toBe("workflow=workflow-1  status=running");

  expect(
    projectEventForJournal(
      event(EventKinds.SchedulerStatusSnapshot, {
        active: true,
        taskCount: 3,
        runningTaskIds: ["task-1"],
        pendingDeliveryCount: 1,
        recoveryMode: "database_claim",
      }),
    ).summary,
  ).toBe("active=true  tasks=3  mode=database_claim");
});

test("event journal correlation reads only the descriptor-declared resource pointer", () => {
  const store = useEventJournalStore.getState();
  store.append([
    {
      connectionId: "ws-test",
      observedAt: "2026-08-04T00:00:00.000Z",
      direction: "inbound",
      stage: "projected",
      envelope: event(EventKinds.ExecutionResourceOutput, {
        resourceId: "res_declared",
        stream: "stdout",
        outputSequence: 1,
        byteLength: 3,
        totalBytes: 3,
      }),
    },
    {
      connectionId: "ws-test",
      observedAt: "2026-08-04T00:00:01.000Z",
      direction: "inbound",
      stage: "projected",
      envelope: event(EventKinds.ToolCallStarted, {
        index: 0,
        toolName: "search",
        callId: "call-1",
        resourceId: "res_undeclared",
        startedAt: "2026-08-04T00:00:00.000Z",
      }),
    },
  ]);

  expect(useEventJournalStore.getState().records.map((record) => record.resourceId)).toEqual([
    "res_declared",
    undefined,
  ]);
});

test("event journal keeps snapshot correlation when a producer omits envelope sessionId", () => {
  const store = useEventJournalStore.getState();
  const runtimeStatus = event(EventKinds.SessionRuntimeStatus, {
    sessionId: "session-from-data",
    runtime: { contextUsage: { tokens: 24, contextWindow: 100, percent: 24 } },
  });
  delete runtimeStatus.sessionId;
  store.append([
    {
      connectionId: "ws-test",
      observedAt: "2026-08-04T00:00:00.000Z",
      direction: "inbound",
      stage: "projected",
      envelope: runtimeStatus,
    },
  ]);

  expect(useEventJournalStore.getState().records[0]?.sessionId).toBe("session-from-data");
});

test("JSON Pointer follows RFC 6901 escaping and array indexing", () => {
  const value = { data: { "a/b": { "~key": ["zero", "one"] } } };

  expect(readJsonPointer(value, "/data/a~1b/~0key/1")).toBe("one");
  expect(readJsonPointer(value, "/data/a~1b/~0key/01")).toBeUndefined();
});

test("event journal rejects an oversized declared projection instead of retaining a partial payload", () => {
  const projected = projectEventForJournal(
    event(EventKinds.ToolCallsPlanned, {
      toolCount: 1,
      tools: ["x".repeat(EventJournalProjectionMaxBytes + 1)],
    }),
  );

  expect(projected).toEqual({ byteLength: 0, omitted: true });
});

test("event journal separates recording, view pause, wire capture, and bounded retention", () => {
  const store = useEventJournalStore.getState();
  store.append([lifecycle("open")]);
  store.append([wire(128)]);
  expect(useEventJournalStore.getState().records.map((record) => record.kind)).toEqual(["socket.open"]);

  store.setWireCapture(true);
  store.append([wire(128)]);
  store.setViewPaused(true);
  const pausedAt = useEventJournalStore.getState().viewPausedAt;
  store.append([lifecycle("closed")]);
  expect(useEventJournalStore.getState().records.at(-1).localSequence).toBeGreaterThan(pausedAt);

  store.setRecording(false);
  store.append([lifecycle("error")]);
  expect(useEventJournalStore.getState().records.at(-1).kind).toBe("socket.closed");

  store.setRecording(true);
  store.clear();
  store.append(Array.from({ length: EventJournalPolicy.maxRecords + 1 }, () => lifecycle("open")));
  expect(useEventJournalStore.getState().records).toHaveLength(EventJournalPolicy.maxRecords);
  expect(useEventJournalStore.getState().totalBytes).toBeLessThanOrEqual(EventJournalPolicy.maxBytes);
});

test("event journal accounts for retained metadata independently from observed frame size", () => {
  const store = useEventJournalStore.getState();
  store.setWireCapture(true);
  store.append([wire(EventJournalPolicy.maxBytes * 4)]);

  expect(useEventJournalStore.getState()).toMatchObject({
    totalBytes: EventJournalPolicy.metadataBytes,
    records: [
      {
        kind: "transport.frame",
        observedByteLength: EventJournalPolicy.maxBytes * 4,
        retainedByteLength: EventJournalPolicy.metadataBytes,
      },
    ],
  });
});

test("event journal recorder installation is idempotent", async () => {
  await Promise.all([installEventJournalRecorder(), installEventJournalRecorder()]);
  publishAgentTransportObservation(lifecycle("open"));

  expect(useEventJournalStore.getState().records.map((record) => record.kind)).toEqual(["socket.open"]);
});

function event(kind, data) {
  return {
    eventId: `event-${kind}`,
    channel: "agent.event",
    kind,
    ...EventSpecs[kind],
    sequence: 1,
    timestamp: "2026-08-04T00:00:00.000Z",
    sessionId: "session-1",
    requestId: "request-1",
    step: 1,
    data,
  };
}

function lifecycle(state) {
  return {
    connectionId: "ws-test",
    observedAt: "2026-08-04T00:00:00.000Z",
    direction: "system",
    stage: "lifecycle",
    state,
  };
}

function wire(byteLength) {
  return {
    connectionId: "ws-test",
    observedAt: "2026-08-04T00:00:00.000Z",
    direction: "inbound",
    stage: "wire",
    byteLength,
  };
}
