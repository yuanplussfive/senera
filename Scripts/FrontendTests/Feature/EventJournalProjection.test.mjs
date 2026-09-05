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

test("event journal keeps continuity state separate from workflow ledgers and internal delivery handles", () => {
  const projected = projectEventForJournal(
    event(EventKinds.ContinuitySnapshot, {
      enabled: true,
      residentProfile: [{ key: "居住地点", claim: "上海" }],
      factCatalog: [{ factKey: "user.location", claim: "上海" }],
      selection: {
        profiles: { available: 1, matched: 1, selected: 1 },
        facts: { available: 3, matched: 1, selected: 1 },
        events: { available: 2, matched: 0, selected: 0 },
        evidence: { available: 0, matched: 0, selected: 0 },
        usedCharacters: 96,
        maxCharacters: 24_000,
      },
      preset: { enabled: false, activePresetName: null },
      evidenceCandidates: [],
      eventCandidates: [],
      rules: [],
      signals: [],
      goals: { goals: [{ id: "goal-1", objective: "完成验证", status: "active" }] },
      execution: { active: null, executions: [{ id: "execution-1", status: "active" }] },
      todos: { items: [{ id: "todo-1", content: "运行校验", status: "in_progress" }], counts: { total: 1 } },
      pendingRuleDeliveryUris: ["senera://continuity-rule/internal"],
    }),
  );

  expect(projected.value?.data).toMatchObject({
    residentProfile: [{ key: "居住地点", claim: "上海" }],
    factCatalog: [{ factKey: "user.location" }],
    selection: { facts: { available: 3, matched: 1, selected: 1 }, usedCharacters: 96 },
  });
  expect(projected.value?.data).not.toHaveProperty("pendingRuleDeliveryUris");
  expect(projected.value?.data).not.toHaveProperty("goals");
  expect(projected.value?.data).not.toHaveProperty("execution");
  expect(projected.value?.data).not.toHaveProperty("todos");
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
