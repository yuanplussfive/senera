import { describe, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentWebSocketEventEnvelopeSender } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketEventSender.js";
import type { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../../../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";

describe("WebSocket event envelope sender", () => {
  test("broadcasts one sequenced envelope to open clients without persisting session history", async () => {
    const fixture = createSenderFixture();
    const first = createSocket(true);
    const second = createSocket(true);

    await fixture.sender.broadcast([first.socket, second.socket], runStartedEvent());

    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledWith(first.send.mock.calls[0]?.[0]);
    expect(JSON.parse(String(first.send.mock.calls[0]?.[0]))).toMatchObject({
      kind: AgentEventKinds.RunStarted,
      sessionId: "session-1",
      requestId: "request-1",
      sequence: 1,
    });
    expect(fixture.event).toHaveBeenCalledTimes(1);
    expect(fixture.recordRunEvents).not.toHaveBeenCalled();
  });

  test("ignores closed clients", async () => {
    const fixture = createSenderFixture();
    const closed = createSocket(false);

    await fixture.sender.broadcast([closed.socket], runStartedEvent());

    expect(closed.send).not.toHaveBeenCalled();
  });

  test("persists projected run events before sending direct envelopes", async () => {
    const fixture = createSenderFixture();
    const client = createSocket(true);

    await fixture.sender.sendEnvelope(client.socket, runStartedEvent());
    await fixture.sender.flush();

    expect(fixture.recordRunEvents).toHaveBeenCalledWith([
      expect.objectContaining({ kind: AgentEventKinds.RunStarted, sequence: 1 }),
    ]);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  test("logs persistence failures without preventing delivery", async () => {
    const failure = new Error("database unavailable");
    const fixture = createSenderFixture(failure);
    const client = createSocket(true);

    await fixture.sender.sendEnvelope(client.socket, runStartedEvent());
    await expect(fixture.sender.flush()).rejects.toThrow(failure);

    expect(fixture.error).toHaveBeenCalledWith(
      "执行事件持久化进入失败状态",
      expect.objectContaining({ requestId: "request-1", error: failure.message }),
    );
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

function createSenderFixture(recordFailure?: Error) {
  const warn = vi.fn();
  const error = vi.fn();
  const event = vi.fn();
  const recordRunEvents = vi.fn(() => {
    if (recordFailure) throw recordFailure;
  });
  return {
    warn,
    error,
    event,
    recordRunEvents,
    sender: new AgentWebSocketEventEnvelopeSender({
      logger: { warn, error } as unknown as AgentLogger,
      eventLogger: { event } as unknown as AgentServerEventLogger,
      eventWriter: new AgentCallbackRunEventWriter(recordRunEvents),
    }),
  };
}

function createSocket(open: boolean): { socket: WebSocket; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  return {
    socket: {
      OPEN: 1,
      readyState: open ? 1 : 3,
      send,
    } as unknown as WebSocket,
    send,
  };
}

function runStartedEvent() {
  return {
    kind: AgentEventKinds.RunStarted,
    context: { sessionId: "session-1", requestId: "request-1" },
    data: { input: "hello" },
  } as const;
}
