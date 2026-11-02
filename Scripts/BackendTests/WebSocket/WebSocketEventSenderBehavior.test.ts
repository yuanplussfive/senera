import { describe, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentWebSocketEventEnvelopeSender } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketEventSender.js";
import type { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../../../Source/AgentSystem/Diagnostics/AgentServerEventLogger.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import { AgentWebSocketDeliveryError } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketDeliveryError.js";
import { AgentWebSocketMessageRouter } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketMessageRouter.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";

describe("WebSocket event envelope sender", () => {
  test("broadcasts one sequenced envelope to open clients without persisting session history", async () => {
    const fixture = createSenderFixture();
    const first = createSocket(true);
    const second = createSocket(true);

    await fixture.sender.broadcast([first.socket, second.socket], runStartedEvent());

    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledWith(first.send.mock.calls[0]?.[0], expect.any(Function));
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

  test("broadcast feedback shares one durable envelope across clients", async () => {
    const fixture = createSenderFixture();
    const first = createSocket(true);
    const second = createSocket(true);
    await fixture.sender.broadcast([first.socket, second.socket], {
      kind: AgentEventKinds.FeedbackRecorded,
      context: { sessionId: "session-1", requestId: "request-1" },
      data: {
        sessionId: "session-1",
        requestId: "request-1",
        rating: "positive",
        updatedAt: "2026-10-27T01:00:00.000Z",
      },
    });
    await fixture.sender.flush();
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledWith(first.send.mock.calls[0][0], expect.any(Function));
    expect(fixture.recordRunEvents).toHaveBeenCalledOnce();
    expect(fixture.recordRunEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: AgentEventKinds.FeedbackRecorded,
        sessionId: "session-1",
        requestId: "request-1",
      }),
    ]);
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

  test("preserves durable events and healthy clients when one socket fails to write", async () => {
    const fixture = createSenderFixture();
    const broken = createSocket(true);
    const healthy = createSocket(true);
    const cause = Object.assign(new Error("write ECONNABORTED"), { code: "ECONNABORTED" });
    broken.send.mockImplementation((_payload: string, callback: (error?: Error) => void) => callback(cause));

    await fixture.sender.broadcast([broken.socket, healthy.socket], runStartedEvent());
    await fixture.sender.flush();

    expect(healthy.send).toHaveBeenCalledOnce();
    expect(broken.terminate).toHaveBeenCalledOnce();
    expect(fixture.recordRunEvents).toHaveBeenCalledOnce();
    expect(fixture.info).toHaveBeenCalledWith("websocket.delivery.interrupted", { error: cause.message });
    await expect(fixture.sender.sendEnvelope(broken.socket, runStartedEvent())).rejects.toBeInstanceOf(
      AgentWebSocketDeliveryError,
    );
    expect(broken.send).toHaveBeenCalledOnce();
    await fixture.sender.close();
  });

  test("does not turn a failed configuration response into an invalid request", async () => {
    const fixture = createSenderFixture();
    const client = createSocket(true);
    client.send.mockImplementation((_payload: string, callback: (error?: Error) => void) =>
      callback(new Error("write ECONNABORTED")),
    );
    const router = new AgentWebSocketMessageRouter({
      context: { configSnapshot: () => ({ ModelProviders: [] }) } as unknown as AgentWebSocketRequestContext,
      sendEnvelope: (socket, event) => fixture.sender.sendEnvelope(socket, event),
      broadcast: (event) => fixture.sender.broadcast([client.socket], event),
    });

    await expect(router.handleMessage(client.socket, Buffer.from('{"type":"config.get"}'))).resolves.toBeUndefined();

    expect(fixture.event.mock.calls.map(([event]) => event.kind)).toEqual([AgentEventKinds.ConfigSnapshot]);
    expect(client.terminate).toHaveBeenCalledOnce();
    expect(fixture.error).not.toHaveBeenCalled();
    await fixture.sender.close();
  });

  test("still reports a genuine configuration failure to a connected client", async () => {
    const fixture = createSenderFixture();
    const client = createSocket(true);
    const router = new AgentWebSocketMessageRouter({
      context: {
        configSnapshot: () => {
          throw new Error("configuration unavailable");
        },
      } as unknown as AgentWebSocketRequestContext,
      sendEnvelope: (socket, event) => fixture.sender.sendEnvelope(socket, event),
      broadcast: (event) => fixture.sender.broadcast([client.socket], event),
    });

    await router.handleMessage(client.socket, Buffer.from('{"type":"config.get"}'));

    expect(JSON.parse(String(client.send.mock.calls[0]?.[0]))).toMatchObject({
      kind: AgentEventKinds.RequestInvalid,
      data: {
        code: "request_execution_failed",
        details: { requestType: "config.get", error: { message: "configuration unavailable" } },
      },
    });
    expect(client.terminate).not.toHaveBeenCalled();
    await fixture.sender.close();
  });
});

function createSenderFixture(recordFailure?: Error) {
  const warn = vi.fn();
  const info = vi.fn();
  const error = vi.fn();
  const event = vi.fn();
  const recordRunEvents = vi.fn(() => {
    if (recordFailure) throw recordFailure;
  });
  return {
    warn,
    info,
    error,
    event,
    recordRunEvents,
    sender: new AgentWebSocketEventEnvelopeSender({
      logger: { warn, info, error } as unknown as AgentLogger,
      eventLogger: { event } as unknown as AgentServerEventLogger,
      eventWriter: new AgentCallbackRunEventWriter(recordRunEvents),
    }),
  };
}

function createSocket(open: boolean) {
  const send = vi.fn((_payload: string, callback: (error?: Error) => void) => callback());
  const terminate = vi.fn(() => {
    socket.readyState = 3;
  });
  const socket = { OPEN: 1, readyState: open ? 1 : 3, bufferedAmount: 0, send, terminate };
  return {
    socket: socket as unknown as WebSocket,
    send,
    terminate,
  };
}

function runStartedEvent() {
  return {
    kind: AgentEventKinds.RunStarted,
    context: { sessionId: "session-1", requestId: "request-1" },
    data: { input: "hello" },
  } as const;
}
