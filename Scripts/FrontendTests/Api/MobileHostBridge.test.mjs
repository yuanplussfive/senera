import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { Blob as NativeBlob } from "node:buffer";
import path from "node:path";
import { expect, test } from "vitest";
import { resolveWorkspaceRoot } from "../../../Scripts/WorkspaceRoot.ts";

const script = readFileSync(
  path.join(resolveWorkspaceRoot(), "Apps", "Mobile", "android", "app", "src", "main", "assets", "senera-host.js"),
  "utf8",
);

function hostDocument(reply) {
  const listeners = new Map();
  const window = { addEventListener: (name, handler) => listeners.set(name, handler) };
  window.top = window;
  const calls = [];
  const seneraNative = {
    postMessage: (value) => {
      const request = JSON.parse(value);
      calls.push(request);
      reply?.(request, (response) => seneraNative.onmessage({ data: JSON.stringify({ id: request.id, ...response }) }));
    },
  };
  runInNewContext(script, { window, seneraNative, crypto: webcrypto, Uint8Array, Uint32Array, btoa, queueMicrotask });
  return {
    host: window.__SENERA_MOBILE__,
    calls,
    listeners,
    event: (id, event) => seneraNative.onmessage({ data: JSON.stringify({ kind: "socket.event", id, event }) }),
  };
}

test("the shared Android bridge streams generated files in bounded acknowledged chunks", async () => {
  const document = hostDocument((request, respond) =>
    respond({ ok: true, result: request.action === "save.begin" ? { transferId: "file-1" } : null }),
  );
  const bytes = new Uint8Array(150_000).fill(42);
  await document.host.saveFile(new NativeBlob([bytes]), "file.bin");
  expect(document.calls.map((call) => call.action)).toEqual([
    "save.begin",
    "save.write",
    "save.write",
    "save.write",
    "save.finish",
  ]);
  const chunks = document.calls
    .filter((call) => call.action === "save.write")
    .map((call) => Buffer.from(call.params.data, "base64"));
  expect(chunks.every((chunk) => chunk.length <= 64 * 1024)).toBe(true);
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  expect(new Set(document.calls.map((call) => call.id)).size).toBe(document.calls.length);
});

test("a failed file write discards its partial output and preserves the actual failure", async () => {
  const document = hostDocument((request, respond) => {
    if (request.action === "save.begin") respond({ ok: true, result: { transferId: "file-1" } });
    else respond({ ok: false, error: request.action === "save.write" ? "storage full" : "already closed" });
  });
  await expect(document.host.saveFile(new NativeBlob(["file"]), "file.txt")).rejects.toThrow("storage full");
  expect(document.calls.at(-1).action).toBe("save.abort");
});

test("closing the document rejects outstanding host requests and new documents use distinct IDs", async () => {
  const first = hostDocument();
  const pending = first.host.openExternal("https://example.com");
  const assertion = expect(pending).rejects.toThrow("document was closed");
  first.listeners.get("pagehide")();
  await assertion;
  const second = hostDocument((_, reply) => reply({ ok: true }));
  await second.host.openExternal("https://example.com");
  expect(first.calls[0].id).not.toBe(second.calls[0].id);
});

test("native sockets keep independent ordered streams and release closed document subscriptions", async () => {
  const document = hostDocument((_, reply) => reply({ ok: true }));
  const first = [];
  const second = [];
  const socket = document.host.connectSocket("wss://computer.test/onebot", (event) => first.push(event));
  document.host.connectSocket("wss://computer.test/control", (event) => second.push(event));
  const [a, b] = document.calls.map((call) => call.params.socketId);
  document.event(a, { type: "open" });
  document.event(a, { type: "message", data: "onebot" });
  document.event(b, { type: "message", data: "console" });
  await socket.send("action");
  await socket.close(1000, "done");
  expect(first.map((event) => event.type)).toEqual(["open", "message"]);
  expect(second).toEqual([{ type: "message", data: "console" }]);
  expect(document.calls.slice(2).map((call) => call.action)).toEqual(["socket.send", "socket.close"]);
  document.event(a, { type: "close", code: 1000, reason: "done", wasClean: true });
  document.event(a, { type: "message", data: "late" });
  await Promise.resolve();
  expect(first.at(-1).type).toBe("close");
  document.listeners.get("pagehide")();
  document.event(b, { type: "message", data: "old document" });
  await Promise.resolve();
  expect(second).toHaveLength(1);
});
