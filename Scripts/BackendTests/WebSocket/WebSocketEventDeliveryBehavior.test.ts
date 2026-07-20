import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { AgentWebSocketEventEnvelopeSender } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketEventSender.js";
import type { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentDefaults } from "../../../Source/AgentSystem/Defaults/AgentDefaultCatalog.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";

describe("WebSocket event delivery", () => {
  it("persists broadcast run events and disconnects a slow client before unbounded buffering", async () => {
    const recordRunEvents = vi.fn();
    const warn = vi.fn();
    const sender = new AgentWebSocketEventEnvelopeSender({
      logger: { warn } as unknown as AgentLogger,
      eventWriter: new AgentCallbackRunEventWriter(recordRunEvents),
      maxBufferedBytes: 1_024,
    });
    const socket = fakeSocket(2_048);

    await sender.broadcast([socket as unknown as WebSocket], resourceOutputEvent());
    await sender.flush();

    expect(recordRunEvents).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1013, "outbound_buffer_exceeded");
    expect(warn).toHaveBeenCalledWith(
      "WebSocket client exceeded the outbound buffer limit.",
      expect.objectContaining({ bufferedBytes: 2_048, maxBufferedBytes: 1_024 }),
    );
  });

  it("delivers an event while the client remains below the buffer limit", async () => {
    const sender = new AgentWebSocketEventEnvelopeSender({
      logger: { warn: vi.fn() } as unknown as AgentLogger,
      eventWriter: new AgentCallbackRunEventWriter(vi.fn()),
      maxBufferedBytes: 1_024,
    });
    const socket = fakeSocket(128);

    await sender.broadcast([socket as unknown as WebSocket], resourceOutputEvent());

    expect(socket.send).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.send.mock.calls[0]![0] as string)).toEqual(
      expect.objectContaining({ kind: "execution.resource.output", sessionId: "session-delivery" }),
    );
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("delivers a multi-mebibyte history payload under the runtime default", async () => {
    const sender = new AgentWebSocketEventEnvelopeSender({
      logger: { warn: vi.fn() } as unknown as AgentLogger,
      eventWriter: new AgentCallbackRunEventWriter(vi.fn()),
      maxBufferedBytes: AgentDefaults.Server.RequestMaxBytes,
    });
    const socket = fakeSocket(0);

    await sender.broadcast([socket as unknown as WebSocket], resourceOutputEvent("x".repeat(5 * 1024 * 1024)));

    expect(socket.send).toHaveBeenCalledOnce();
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("retries transient persistence failures before reporting success", async () => {
    let attempts = 0;
    const recordRunEvents = vi.fn(() => {
      attempts += 1;
      if (attempts < 3) throw new Error("database is locked");
    });
    const sender = new AgentWebSocketEventEnvelopeSender({
      logger: { warn: vi.fn(), error: vi.fn() } as unknown as AgentLogger,
      eventWriter: new AgentCallbackRunEventWriter(recordRunEvents),
      persistence: { maxAttempts: 3, retryDelayMs: 1 },
    });

    await sender.broadcast([], resourceOutputEvent());
    await sender.flush();

    expect(recordRunEvents).toHaveBeenCalledTimes(3);
    expect(sender.persistenceHealth()).toMatchObject({
      pendingEvents: 0,
      failedEvents: 0,
      overflowEvents: 0,
      state: "healthy",
    });
  });

  it("keeps permanent persistence failures observable instead of silently dropping them", async () => {
    const failures: unknown[] = [];
    const sender = new AgentWebSocketEventEnvelopeSender({
      logger: { warn: vi.fn(), error: vi.fn() } as unknown as AgentLogger,
      eventWriter: new AgentCallbackRunEventWriter(() => {
        throw new Error("database is closed");
      }),
      persistence: { maxAttempts: 2, retryDelayMs: 1, onFailure: (failure) => failures.push(failure) },
    });

    await sender.broadcast([], resourceOutputEvent());
    await expect(sender.flush()).rejects.toThrow("database is closed");

    expect(failures).toHaveLength(1);
    expect(sender.persistenceHealth()).toMatchObject({ pendingEvents: 1, failedEvents: 1, overflowEvents: 0 });
  });

  it("backpressures at the queue watermark without evicting history events", async () => {
    const failures: unknown[] = [];
    const recordRunEvents = vi.fn();
    const sender = new AgentWebSocketEventEnvelopeSender({
      logger: { warn: vi.fn(), error: vi.fn() } as unknown as AgentLogger,
      eventWriter: new AgentCallbackRunEventWriter(recordRunEvents),
      persistence: { maxPendingEvents: 1, onFailure: (failure) => failures.push(failure) },
    });

    void sender.broadcast([], resourceOutputEvent("first"));
    await sender.broadcast([], resourceOutputEvent("second"));
    await sender.flush();

    expect(failures).toHaveLength(0);
    expect(recordRunEvents).toHaveBeenCalledOnce();
    expect(recordRunEvents.mock.calls[0]?.[0]).toHaveLength(2);
    expect(sender.persistenceHealth()).toMatchObject({ pendingEvents: 0 });
  });
});

function fakeSocket(bufferedAmount: number) {
  return {
    OPEN: 1,
    readyState: 1,
    bufferedAmount,
    send: vi.fn(),
    close: vi.fn(),
  };
}

function resourceOutputEvent(text = "output") {
  return {
    kind: "execution.resource.output" as const,
    context: {
      sessionId: "session-delivery",
      requestId: "request-delivery",
      step: 1,
    },
    data: {
      resourceId: "res_00000000000000000000000000000000",
      cursor: 2,
      stream: "stdout" as const,
      text,
      byteLength: Buffer.byteLength(text),
      totalBytes: Buffer.byteLength(text),
    },
  };
}
