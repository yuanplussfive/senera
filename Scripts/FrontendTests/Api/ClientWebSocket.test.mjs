import { afterEach, expect, test, vi } from "vitest";
import { createClientWebSocket } from "../../../Frontend/src/api/clientWebSocket.ts";

afterEach(() => {
  delete window.__SENERA_MOBILE__;
  vi.unstubAllGlobals();
});

test("ordinary browsers use the native browser WebSocket with the original URL", () => {
  const ctor = vi.fn(function () {
    this.readyState = 0;
  });
  vi.stubGlobal("WebSocket", ctor);
  const socket = createClientWebSocket("wss://computer.test/control?workspaceId=a");
  expect(socket).toBeInstanceOf(ctor);
  expect(ctor).toHaveBeenCalledWith("wss://computer.test/control?workspaceId=a");
  expect(() => createClientWebSocket("https://computer.test")).toThrow("Invalid client");
});

function hostSocket() {
  let receive;
  const port = { send: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
  window.__SENERA_MOBILE__ = {
    connectSocket: vi.fn((_, handler) => {
      receive = handler;
      return port;
    }),
  };
  return { socket: createClientWebSocket("wss://computer.test/control"), port, event: (value) => receive(value) };
}

test("Android follows open/message/close states and sends unmodified protocol text", async () => {
  const { socket, port, event } = hostSocket();
  const messages = [];
  const closed = vi.fn();
  socket.onmessage = (message) => messages.push(message.data);
  socket.onclose = closed;
  expect(() => socket.send("too early")).toThrow("not open");
  event({ type: "open" });
  expect(socket.readyState).toBe(WebSocket.OPEN);
  socket.send('{"action":"send_msg"}');
  expect(port.send).toHaveBeenCalledWith('{"action":"send_msg"}');
  event({ type: "message", data: '{"echo":"id"}' });
  expect(messages).toEqual(['{"echo":"id"}']);
  socket.close(4000, "resync");
  expect(socket.readyState).toBe(WebSocket.CLOSING);
  event({ type: "close", code: 4000, reason: "resync", wasClean: true });
  event({ type: "message", data: "late" });
  expect(socket.readyState).toBe(WebSocket.CLOSED);
  expect(closed).toHaveBeenCalledOnce();
  expect(messages).toHaveLength(1);
  expect(() => socket.close(1006)).toThrow("Invalid close code");
});

test("a host send failure emits a recoverable close instead of leaving an open zombie", async () => {
  const { socket, port, event } = hostSocket();
  event({ type: "open" });
  const error = vi.fn();
  const closed = vi.fn();
  socket.onerror = error;
  socket.onclose = closed;
  port.send.mockRejectedValueOnce(new Error("native connection gone"));
  socket.send("action");
  await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED));
  expect(error).toHaveBeenCalledOnce();
  expect(closed.mock.calls[0][0]).toMatchObject({ code: 1006, wasClean: false });
  expect(port.close).toHaveBeenCalledWith(4000, "host_transport_failed");
});
