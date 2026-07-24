import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import {
  parseAgentSocketEventData,
  readAgentSocketRetryDelayMs,
  useAgentSocket,
} from "../../../Frontend/src/api/useAgentSocket.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  TestWebSocket.reset();
});

test("agent socket retry delay uses capped exponential backoff", () => {
  expect(readAgentSocketRetryDelayMs(0, () => 0)).toBe(500);
  expect(readAgentSocketRetryDelayMs(0, () => 1)).toBe(1000);
  expect(readAgentSocketRetryDelayMs(1, () => 1)).toBe(2000);
  expect(readAgentSocketRetryDelayMs(4, () => 1)).toBe(15000);
  expect(readAgentSocketRetryDelayMs(20, () => 1)).toBe(15000);
  expect(readAgentSocketRetryDelayMs(-1, () => 1)).toBe(1000);
});

test("agent socket event parser accepts string event payloads and rejects malformed frames", () => {
  const env = parseAgentSocketEventData(
    JSON.stringify({
      channel: "agent.event",
      kind: EventKinds.RunStarted,
      layer: "progress",
      phase: "run",
      sequence: 1,
      timestamp: "2026-07-09T00:00:00.000Z",
      data: { input: "hello" },
    }),
  );

  expect(env.kind).toBe(EventKinds.RunStarted);
  expect(env.data).toEqual({ input: "hello" });
  expect(() => parseAgentSocketEventData({})).toThrow();
  expect(() => parseAgentSocketEventData("{")).toThrow();
});

test("agent socket owns connection state, ordered streaming delivery, malformed frames, and retry", () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.stubGlobal("WebSocket", TestWebSocket);
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
  const onEvent = vi.fn();
  const onMalformedEvent = vi.fn();
  const handleRef = { current: null };
  render(
    React.createElement(SocketHarness, {
      handleRef,
      onEvent,
      onMalformedEvent,
      url: "ws://agent.test/runtime",
    }),
  );

  const firstSocket = TestWebSocket.instances[0];
  expect(firstSocket.url).toBe("ws://agent.test/runtime");
  expect(handleRef.current.status).toBe("connecting");
  expect(handleRef.current.send({ type: "session.list" })).toBe(false);

  act(() => firstSocket.open());
  expect(handleRef.current.status).toBe("open");
  expect(handleRef.current.send({ type: "session.list" })).toBe(true);
  expect(firstSocket.sent).toEqual([JSON.stringify({ type: "session.list" })]);

  act(() => {
    firstSocket.receive(event(EventKinds.ModelDelta, 1, { text: "stream " }));
    firstSocket.receive(event(EventKinds.ModelDelta, 2, { text: "chunk" }));
    firstSocket.receive(event(EventKinds.RunCompleted, 3, {}));
  });
  expect(onEvent.mock.calls.map(([value]) => [value.kind, value.data])).toEqual([
    [EventKinds.ModelDelta, { text: "stream chunk" }],
    [EventKinds.RunCompleted, {}],
  ]);

  act(() => firstSocket.receiveRaw("{"));
  expect(onMalformedEvent).toHaveBeenCalledTimes(1);

  act(() => firstSocket.disconnect());
  expect(handleRef.current.status).toBe("closed");
  expect(handleRef.current.send({ type: "session.list" })).toBe(false);

  act(() => vi.advanceTimersByTime(readAgentSocketRetryDelayMs(0)));
  expect(TestWebSocket.instances).toHaveLength(2);
  expect(handleRef.current.status).toBe("connecting");
});

test("agent socket delivers one ordered transaction for events received in the same frame", () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", TestWebSocket);
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
  const onEvents = vi.fn();
  const handleRef = { current: null };
  render(
    React.createElement(SocketHarness, {
      handleRef,
      onEvents,
      url: "ws://agent.test/runtime",
    }),
  );

  const socket = TestWebSocket.instances[0];
  act(() => socket.open());
  act(() => {
    socket.receive(event(EventKinds.ModelDelta, 1, { text: "stream " }));
    socket.receive(event(EventKinds.ModelDelta, 2, { text: "chunk" }));
    socket.receive(event(EventKinds.RunCompleted, 3, {}));
  });

  expect(onEvents).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(16));
  expect(onEvents).toHaveBeenCalledTimes(1);
  expect(onEvents.mock.calls[0][0].map((value) => [value.kind, value.sequence, value.data])).toEqual([
    [EventKinds.ModelDelta, 1, { text: "stream chunk" }],
    [EventKinds.RunCompleted, 3, {}],
  ]);
});

test("agent socket turns synchronous connection failures into retryable error state", () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.stubGlobal(
    "WebSocket",
    class RejectingWebSocket {
      constructor() {
        throw new DOMException("blocked", "SecurityError");
      }
    },
  );
  const handleRef = { current: null };
  render(
    React.createElement(SocketHarness, {
      handleRef,
      onEvent: vi.fn(),
      url: "ws://blocked.test/runtime",
    }),
  );

  expect(handleRef.current.status).toBe("error");
  act(() => vi.advanceTimersByTime(readAgentSocketRetryDelayMs(0)));
  expect(handleRef.current.status).toBe("error");
});

test("agent socket does not connect while disabled and cancels pending reconnects when disabled", () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.stubGlobal("WebSocket", TestWebSocket);
  const handleRef = { current: null };
  const props = {
    handleRef,
    onEvent: vi.fn(),
    url: "ws://agent.test/runtime",
  };
  const { rerender } = render(React.createElement(SocketHarness, { ...props, enabled: false }));

  expect(TestWebSocket.instances).toHaveLength(0);
  expect(handleRef.current.status).toBe("idle");

  rerender(React.createElement(SocketHarness, { ...props, enabled: true }));
  expect(TestWebSocket.instances).toHaveLength(1);
  act(() => TestWebSocket.instances[0].disconnect());

  rerender(React.createElement(SocketHarness, { ...props, enabled: false }));
  act(() => vi.advanceTimersByTime(15_000));
  expect(TestWebSocket.instances).toHaveLength(1);
  expect(handleRef.current.status).toBe("idle");
});

test("agent socket delegates a failed handshake to the reconnect policy and honors a stop decision", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", TestWebSocket);
  const reconnectPolicy = vi.fn(async () => "stop");
  const handleRef = { current: null };
  render(
    React.createElement(SocketHarness, {
      handleRef,
      onEvent: vi.fn(),
      reconnectPolicy,
      url: "ws://agent.test/runtime",
    }),
  );

  await act(async () => {
    TestWebSocket.instances[0].disconnect(1006, "", false);
    await Promise.resolve();
  });

  expect(reconnectPolicy).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false, opened: false });
  act(() => vi.advanceTimersByTime(15_000));
  expect(TestWebSocket.instances).toHaveLength(1);
});

function SocketHarness({ handleRef, ...options }) {
  const handle = useAgentSocket(options);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

class TestWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  static reset() {
    TestWebSocket.instances = [];
  }

  constructor(url) {
    this.url = url;
    this.readyState = TestWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    TestWebSocket.instances.push(this);
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.onopen?.({ type: "open" });
  }

  send(value) {
    this.sent.push(value);
  }

  receive(value) {
    this.receiveRaw(JSON.stringify(value));
  }

  receiveRaw(data) {
    this.onmessage?.({ data });
  }

  disconnect(code = 1006, reason = "", wasClean = false) {
    this.readyState = TestWebSocket.CLOSED;
    this.onclose?.({ type: "close", code, reason, wasClean });
  }

  close() {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.disconnect();
  }
}

function event(kind, sequence, data) {
  return {
    channel: "agent.event",
    kind,
    layer: "progress",
    phase: kind === EventKinds.ModelDelta ? "model" : "run",
    sequence,
    timestamp: `2026-07-11T00:00:0${sequence}.000Z`,
    sessionId: "session-a",
    requestId: "request-a",
    step: 1,
    data,
  };
}
