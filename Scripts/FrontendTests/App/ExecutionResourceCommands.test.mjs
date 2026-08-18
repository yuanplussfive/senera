import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useExecutionResourceCommands } from "../../../Frontend/src/app/useExecutionResourceCommands.ts";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("execution resources are hidden immediately when the active session changes", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  const view = render(
    React.createElement(ExecutionResourceHarness, {
      activeSessionId: "session-one",
      send,
      handleRef,
    }),
  );

  act(() => {
    handleRef.current.handleEvent(
      event(EventKinds.ExecutionResourceSnapshot, "session-one", {
        operation: "list",
        resources: [terminalResource("terminal-one")],
      }),
    );
  });
  expect(handleRef.current.resources.map((resource) => resource.resourceId)).toEqual(["terminal-one"]);

  view.rerender(
    React.createElement(ExecutionResourceHarness, {
      activeSessionId: "session-two",
      send,
      handleRef,
    }),
  );

  expect(handleRef.current.resources).toEqual([]);
  expect(handleRef.current.outputs).toEqual({});
  expect(
    handleRef.current.handleEvent(
      event(EventKinds.ExecutionResourceCreated, "session-one", {
        resource: terminalResource("stale-terminal"),
      }),
    ),
  ).toBe(false);
});

test("terminal output gaps wait for an inspect snapshot and recover in cursor order", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(
    React.createElement(ExecutionResourceHarness, {
      activeSessionId: "session-one",
      send,
      handleRef,
    }),
  );
  send.mockClear();

  act(() => {
    handleRef.current.handleEvent(outputEvent("session-one", 1, 1, "one\r\n"));
  });
  expect(handleRef.current.outputs["terminal-one"].text).toBe("one\r\n");

  act(() => {
    handleRef.current.handleEvent(outputEvent("session-one", 3, 3, "three\r\n"));
    handleRef.current.handleEvent(outputEvent("session-one", 4, 4, "four\r\n"));
  });

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({
    type: "execution.resource.inspect",
    sessionId: "session-one",
    resourceId: "terminal-one",
    cursor: 1,
  });
  expect(handleRef.current.outputs["terminal-one"].text).toBe("one\r\n");

  act(() => {
    handleRef.current.handleEvent(
      event(EventKinds.ExecutionResourceSnapshot, "session-one", {
        operation: "inspect",
        resources: [
          terminalResource("terminal-one", [
            resourceOutput(2, "two\r\n"),
            resourceOutput(3, "three\r\n"),
            resourceOutput(4, "four\r\n"),
          ]),
        ],
      }),
    );
    handleRef.current.handleEvent(outputEvent("session-one", 5, 5, "five\r\n"));
  });

  expect(handleRef.current.outputs["terminal-one"]).toMatchObject({
    cursor: 5,
    text: "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n",
  });
});

test("a delayed truncated inspect snapshot cannot replace newer terminal input", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(
    React.createElement(ExecutionResourceHarness, {
      activeSessionId: "session-one",
      send,
      handleRef,
    }),
  );

  act(() => {
    handleRef.current.handleEvent(outputEvent("session-one", 1, 1, "PS E:\\workspace> "));
    handleRef.current.handleEvent(outputEvent("session-one", 2, 2, "111"));
  });
  expect(handleRef.current.outputs["terminal-one"].text).toBe("PS E:\\workspace> 111");

  act(() => {
    handleRef.current.handleEvent(
      event(EventKinds.ExecutionResourceSnapshot, "session-one", {
        operation: "inspect",
        resources: [
          {
            ...terminalResource("terminal-one", [resourceOutput(1, "PS E:\\workspace> stale-command")]),
            truncated: true,
          },
        ],
      }),
    );
  });

  expect(handleRef.current.outputs["terminal-one"]).toMatchObject({
    cursor: 2,
    generation: 0,
    text: "PS E:\\workspace> 111",
  });
});

test("terminal recovery follows output that arrives while an inspect snapshot is in flight", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  render(
    React.createElement(ExecutionResourceHarness, {
      activeSessionId: "session-one",
      send,
      handleRef,
    }),
  );
  send.mockClear();

  act(() => {
    handleRef.current.handleEvent(outputEvent("session-one", 1, 1, "one\r\n"));
    handleRef.current.handleEvent(outputEvent("session-one", 3, 3, "three\r\n"));
    handleRef.current.handleEvent(outputEvent("session-one", 4, 4, "four\r\n"));
  });
  expect(send).toHaveBeenCalledOnce();

  act(() => {
    handleRef.current.handleEvent(
      event(EventKinds.ExecutionResourceSnapshot, "session-one", {
        operation: "inspect",
        resources: [terminalResource("terminal-one", [resourceOutput(2, "two\r\n"), resourceOutput(3, "three\r\n")])],
      }),
    );
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({
    type: "execution.resource.inspect",
    sessionId: "session-one",
    resourceId: "terminal-one",
    cursor: 3,
  });

  act(() => {
    handleRef.current.handleEvent(
      event(EventKinds.ExecutionResourceSnapshot, "session-one", {
        operation: "inspect",
        resources: [terminalResource("terminal-one", [resourceOutput(4, "four\r\n")])],
      }),
    );
  });
  expect(handleRef.current.outputs["terminal-one"].text).toBe("one\r\ntwo\r\nthree\r\nfour\r\n");
});

function ExecutionResourceHarness({ activeSessionId, send, handleRef }) {
  const handle = useExecutionResourceCommands({ activeSessionId, send, status: "open" });
  useEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

function event(kind, sessionId, data) {
  return {
    channel: "agent.event",
    kind,
    layer: "progress",
    phase: "tool",
    sequence: 1,
    timestamp: "2026-08-15T00:00:00.000Z",
    sessionId,
    data,
  };
}

function outputEvent(sessionId, cursorStart, cursor, text) {
  return event(EventKinds.ExecutionResourceOutput, sessionId, {
    resourceId: "terminal-one",
    cursorStart,
    cursor,
    stream: "stdout",
    text,
    byteLength: text.length,
    totalBytes: text.length,
  });
}

function resourceOutput(cursor, text) {
  return {
    cursor,
    timestamp: "2026-08-15T00:00:00.000Z",
    kind: "output",
    stream: "stdout",
    text,
    byteLength: text.length,
    totalBytes: text.length,
  };
}

function terminalResource(resourceId, events = []) {
  return {
    resourceId,
    kind: "terminal",
    state: "running",
    command: "powershell",
    cwd: "E:\\workspace",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    cursor: events.at(-1)?.cursor ?? 0,
    oldestCursor: events[0]?.cursor ?? 1,
    truncated: false,
    events,
    terminal: {
      backend: "host-pty",
      shellDialect: "powershell",
      requestedBoundary: "local",
      effectiveBoundary: "local",
      capabilities: ["persistent", "interactive-input", "resize", "signals"],
      columns: 100,
      rows: 30,
    },
  };
}
