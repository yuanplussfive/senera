import { afterEach, expect, test, vi } from "vitest";
import { AgentChannelsDatabase } from "../../../Source/AgentSystem/Channels/AgentChannelsDatabase.js";
import {
  AgentChannelOutbox,
  type AgentChannelOutboxEntry,
} from "../../../Source/AgentSystem/Channels/AgentChannelOutbox.js";
import { AgentChannelIngress } from "../../../Source/AgentSystem/Channels/AgentChannelIngress.js";
import { AgentChannelDelivery } from "../../../Source/AgentSystem/Channels/AgentChannelDelivery.js";
import type {
  AgentChannelAdapter,
  AgentChannelInboundMessage,
} from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { cleanupChannelsTestRoots, openChannelsTestDatabase, TestChannelSource } from "./AgentChannelTestSupport.js";

const databases: AgentChannelsDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) if (database.connection.open) database.close();
  cleanupChannelsTestRoots();
});

function open() {
  const database = openChannelsTestDatabase();
  databases.push(database);
  return database;
}

function reopen(database: AgentChannelsDatabase) {
  const path = database.connection.name;
  database.close();
  const replacement = new AgentChannelsDatabase(path);
  databases.push(replacement);
  return replacement;
}

function adapter(): AgentChannelAdapter {
  return {
    kind: "telegram",
    capabilities: {
      maxMessageLength: 4096,
      splitsLongMessages: true,
      supportsEdit: false,
      supportsDraft: false,
      markdown: "plain",
      commandPrefix: "/",
    },
    bind: () => undefined,
    connect: async () => undefined,
    disconnect: async () => undefined,
    getConnectionState: () => "connected",
    send: vi.fn<AgentChannelAdapter["send"]>(async () => ({ kind: "sent", messageId: "receipt" })),
    handleWebhookUpdate: async () => false,
  };
}

function outgoing(id: string, state: AgentChannelOutboxEntry["state"] = "pending"): AgentChannelOutboxEntry {
  return {
    id,
    source: TestChannelSource,
    content: id,
    options: { deliveryId: id, chatType: "direct" },
    attempts: state === "sending" ? 1 : 0,
    state,
  };
}

test("restores pending sends after reopening SQLite and reuses committed receipts", async () => {
  let database = open();
  new AgentChannelOutbox(database.connection).accept(outgoing("pending"));
  database = reopen(database);
  const transport = adapter();
  const delivery = new AgentChannelDelivery({
    adapter: transport,
    outbox: new AgentChannelOutbox(database.connection),
  });
  delivery.resume();
  await delivery.flush();
  expect(transport.send).toHaveBeenCalledTimes(1);
  delivery.stop();
  database = reopen(database);
  const restored = new AgentChannelDelivery({
    adapter: transport,
    outbox: new AgentChannelOutbox(database.connection),
  });
  expect(
    await restored.enqueueAndWait(TestChannelSource, "pending", { deliveryId: "pending", chatType: "direct" }),
  ).toEqual({ status: "sent", messageId: "receipt", attempts: 1 });
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(() =>
    restored.enqueueAndWait(TestChannelSource, "changed", { deliveryId: "pending", chatType: "direct" }),
  ).toThrow("different payloads");
  restored.stop();
});

test("does not repeat an unacknowledged send after restart and rechecks permissions", async () => {
  let database = open();
  const initial = new AgentChannelOutbox(database.connection);
  initial.accept(outgoing("unknown", "sending"));
  initial.accept(outgoing("revoked"));
  database = reopen(database);
  const transport = adapter();
  const outbox = new AgentChannelOutbox(database.connection);
  const dropped = vi.fn();
  const delivery = new AgentChannelDelivery({ adapter: transport, outbox, authorize: () => false, onDropped: dropped });
  delivery.resume();
  await delivery.flush();
  expect(transport.send).not.toHaveBeenCalled();
  expect(dropped).toHaveBeenCalledTimes(1);
  expect(outbox.accept(outgoing("unknown"))).toMatchObject({
    state: "uncertain",
    receipt: { code: "delivery_unknown" },
  });
  expect(
    await delivery.enqueueAndWait(TestChannelSource, "revoked", { deliveryId: "revoked", chatType: "direct" }),
  ).toMatchObject({ status: "failed", code: "revoked", attempts: 0 });
  delivery.stop();
});

test("a failed receipt commit never retries an accepted platform send", async () => {
  const database = open();
  const outbox = new AgentChannelOutbox(database.connection);
  const save = outbox.save.bind(outbox);
  vi.spyOn(outbox, "save").mockImplementation((entry) => {
    if (entry.state === "sent") throw new Error("Storage unavailable");
    save(entry);
  });
  const transport = adapter();
  const onError = vi.fn();
  const delivery = new AgentChannelDelivery({ adapter: transport, outbox, onError });
  expect(
    await delivery.enqueueAndWait(TestChannelSource, "payload", { deliveryId: "commit", chatType: "direct" }),
  ).toMatchObject({ status: "failed", code: "storage_failed", attempts: 1 });
  await delivery.flush();
  delivery.resume();
  await delivery.flush();
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(outbox.accept({ ...outgoing("commit"), content: "payload" })).toMatchObject({ state: "uncertain" });
  delivery.stop();
});

test("persists ingress before media import, keeps original targets, and compacts accepted payloads", async () => {
  let database = open();
  let ingress = new AgentChannelIngress(database.connection);
  const message: AgentChannelInboundMessage = {
    source: { ...TestChannelSource, messageId: "native" },
    text: "attachment",
    attachments: [{ id: "image", mediaType: "image", filename: "image.png", url: "https://example.com/image.png" }],
    segments: [{ type: "image", data: { file: "inline payload" } }],
    raw: { headers: { authorization: "never-persist" } },
  };
  const first = ingress.capture(message, [{ source: TestChannelSource, sessionId: "old-session" }]);
  expect(first.message.raw).toBeUndefined();
  database = reopen(database);
  ingress = new AgentChannelIngress(database.connection);
  const pending = ingress.pending("telegram")[0]!;
  expect(pending.message.attachments).toEqual(message.attachments);
  expect(pending.targets[0]?.sessionId).toBe("old-session");
  await ingress.run(pending, async () => "accepted");
  const repeated = ingress.capture(message, [{ source: TestChannelSource, sessionId: "new-session" }]);
  expect(repeated).toMatchObject({ state: "accepted", targets: [{ sessionId: "old-session" }] });
  expect(repeated.message.attachments).toBeUndefined();
  expect(repeated.message.segments).toBeUndefined();
  const dispatch = vi.fn(async () => "accepted" as const);
  await ingress.run(repeated, dispatch);
  expect(dispatch).not.toHaveBeenCalled();
});

test("retains failed imports and shares concurrent native dispatch", async () => {
  const database = open();
  const ingress = new AgentChannelIngress(database.connection);
  const message = { source: { ...TestChannelSource, messageId: "failed" }, text: "file" };
  const entry = ingress.capture(message, [{ source: TestChannelSource, sessionId: "session" }]);
  const importMedia = vi.fn(async () => {
    throw new Error("Media unavailable");
  });
  const first = ingress.run(entry, importMedia);
  const repeated = ingress.run(entry, importMedia);
  expect(first).toBe(repeated);
  await expect(first).rejects.toThrow("Media unavailable");
  expect(importMedia).toHaveBeenCalledTimes(1);
  expect(ingress.pending("telegram")).toEqual([]);
  expect(ingress.capture(message, [])).toMatchObject({
    state: "failed",
    error: "Media unavailable",
    targets: [{ sessionId: "session" }],
  });
});
