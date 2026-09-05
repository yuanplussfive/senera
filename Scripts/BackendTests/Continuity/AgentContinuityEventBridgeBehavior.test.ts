import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentContinuityEventBridge } from "../../../Source/AgentSystem/Continuity/AgentContinuityEventBridge.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity event bridge", () => {
  test("projects tool lifecycle into one current runtime signal", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const bridge = new AgentContinuityEventBridge({ store, identity: testContinuityIdentity(workspace) });
    try {
      const completed = event(AgentEventKinds.ToolCallCompleted, {
        toolName: "BrowserRead",
        callId: "call-1",
      });
      bridge.observe(completed);
      bridge.observe(completed);
      bridge.observe(
        event(AgentEventKinds.ToolCallFailed, {
          toolName: "BrowserRead",
          callId: "call-2",
        }),
      );

      expect(store.listSignals([{ kind: "runtime", id: `${workspace}:runtime` }])).toEqual([
        expect.objectContaining({
          namespace: "runtime.tool",
          key: "BrowserRead",
          value: "failed",
          sourceRefs: [expect.stringMatching(/^senera:\/\/event\//u)],
        }),
      ]);
      expect(
        store
          .listEventObservations([{ kind: "runtime", id: `${workspace}:runtime` }])
          .filter((entry) => entry.kind === "runtime.signal"),
      ).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  test("projects scheduler and child lifecycle without plugin-specific mappings", () => {
    const workspace = createWorkspace();
    const store = new AgentContinuitySqliteStore(path.join(workspace, "memory.sqlite"));
    const bridge = new AgentContinuityEventBridge({ store, identity: testContinuityIdentity(workspace) });
    try {
      bridge.observe(
        event(AgentEventKinds.ScheduledTaskRunCompleted, {
          taskId: "task-1",
          status: "success",
        }),
      );
      bridge.observe(
        event(AgentEventKinds.ChildRunCompleted, {
          childRunId: "child-1",
          status: "completed",
        }),
      );

      expect(store.listSignals([{ kind: "runtime", id: `${workspace}:runtime` }])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ namespace: "runtime.schedule", key: "task-1", value: "success" }),
          expect.objectContaining({ namespace: "runtime.child", key: "child-1", value: "completed" }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  test("isolates persistence failures from the observed event stream", () => {
    const recordObservation = vi.fn(() => {
      throw new Error("database unavailable");
    });
    const upsertSignal = vi.fn();
    const bridge = new AgentContinuityEventBridge({
      store: { recordObservation, upsertSignal } as unknown as AgentContinuitySqliteStore,
      identity: testContinuityIdentity("workspace"),
    });

    expect(() =>
      bridge.observe(
        event(AgentEventKinds.ToolCallCompleted, {
          toolName: "BrowserRead",
        }),
      ),
    ).not.toThrow();
    expect(recordObservation).toHaveBeenCalledOnce();
    expect(upsertSignal).not.toHaveBeenCalled();
  });
});

function event(kind: AgentDomainEvent["kind"], data: Record<string, unknown>): AgentDomainEvent {
  return {
    eventId: `${kind}-${JSON.stringify(data)}`,
    kind,
    context: { sessionId: "session-1", requestId: "request-1" },
    data,
  } as AgentDomainEvent;
}

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-event-bridge");
  workspaces.add(workspace);
  return workspace;
}
