import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { AgentOneBot11MessageStore } from "../../../Source/AgentSystem/Channels/Adapters/AgentOneBot11MessageStore.js";
import { AgentChannelChatTypes, AgentChannelKinds } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { serializeAgentChannelLane } from "../../../Source/AgentSystem/Channels/AgentChannelSessionIdentity.js";

const source = {
  platform: AgentChannelKinds.OneBot11,
  chatType: AgentChannelChatTypes.Direct,
  chatId: "100",
  userId: "200",
} as const;
const input = {
  source,
  direction: "inbound",
  text: "original",
  senderId: "200",
  segments: [{ type: "text", data: { text: "original" } }],
} as const;
const task = { sessionId: "session", requestId: "request" };
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "senera-onebot-store-"));
  const file = path.join(directory, "messages.sqlite");
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return {
    file,
    open: () => {
      const store = new AgentOneBot11MessageStore(file);
      cleanups.push(() => store.close());
      return store;
    },
  };
}

test("restarts with the original rich message, recall snapshot, poke, task identity, and unified ordering", () => {
  const f = fixture();
  const first = f.open();
  const message = first.append(input, task);
  const notice = {
    post_type: "notice",
    notice_type: "friend_recall",
    message_id: Number(message.id),
    time: 1_792_800_000,
    originMsg: { message: input.segments },
  };
  first.recall(message.id, source, "recall", notice);
  first.appendNotice(source, "poke", { post_type: "notice", sub_type: "poke", time: 1_792_800_001 }, task);
  first.close();
  const restarted = f.open();
  expect(restarted.get(message.id)?.segments).toEqual(input.segments);
  expect(restarted.history(source, 20)).toEqual([]);
  expect(restarted.timeline(source, 20)).toMatchObject([
    { key: "event:poke", task },
    { key: "event:recall", notice, task },
  ]);
  expect(restarted.append(input).id).not.toBe(message.id);
});

test("indexes original media metadata from old message records and retains it after clearing history", () => {
  const f = fixture();
  const first = f.open();
  first.append({
    ...input,
    segments: [
      {
        type: "image",
        data: {
          file: "/23e2d4bf-8109-48aa-897f-7f34cc5a7873.bin",
          name: "drawing.svg",
          content_type: "image/svg+xml",
        },
      },
    ],
  });
  first.close();
  const legacy = new DatabaseSync(f.file);
  legacy.exec("DROP TABLE media_metadata");
  legacy.close();
  const restored = f.open();
  const name = "23e2d4bf-8109-48aa-897f-7f34cc5a7873.bin";
  expect(restored.mediaMetadata(name)).toEqual({ name: "drawing.svg", mime: "image/svg+xml" });
  restored.clear(source);
  expect(restored.mediaMetadata(name)).toEqual({ name: "drawing.svg", mime: "image/svg+xml" });
});

test("removes all messages and notices of a task without touching other sessions, tasks or lanes", () => {
  const store = fixture().open();
  const first = store.append(input, task);
  store.append({ ...input, direction: "outbound" }, task);
  store.appendNotice(source, "poke", { sub_type: "poke" }, task);
  const otherTask = store.append(input, { ...task, requestId: "later" });
  const otherSession = store.append(input, { ...task, sessionId: "other" });
  const otherLane = { ...source, chatId: "300" };
  const otherMessage = store.append({ ...input, source: otherLane }, { sessionId: "other-lane", requestId: "request" });
  store.removeRequests(task.sessionId, [task.requestId]);
  expect(store.get(first.id)).toBeUndefined();
  expect(store.timeline(source, 20).map((entry) => entry.messageId)).toEqual([otherSession.id, otherTask.id]);
  expect(store.history(otherLane, 20).map((entry) => entry.id)).toEqual([otherMessage.id]);
  expect(store.revision(source)).toBe(1);
  expect(store.revision(otherLane)).toBe(0);
});

test("deleting one Agent keeps shared inbound history and the other Agent's replies", () => {
  const store = fixture().open();
  const shared = store.append(input, task);
  const other = { sessionId: "other-agent-session", requestId: "other-request" };
  store.bind(source, `message:${shared.id}`, other, true);
  const ownReply = store.append({ ...input, direction: "outbound", senderId: "100" }, task);
  const peerReply = store.append({ ...input, direction: "outbound", senderId: "300" }, other);
  store.appendNotice(source, "owned-event", { sub_type: "poke" }, task);
  store.removeSession(task.sessionId);
  store.removeSender("100");
  expect(store.get(ownReply.id)).toBeUndefined();
  expect(store.get(shared.id)).toBeDefined();
  expect(store.get(peerReply.id)).toBeDefined();
  expect(store.tasks(`message:${shared.id}`)).toEqual([other]);
  expect(store.timeline(source, 20).some((entry) => entry.key === "event:owned-event")).toBe(false);
  store.removeSession(other.sessionId);
  expect(store.timeline(source, 20)).toEqual([]);
});

test("pages a mixed timeline with one cursor and keeps IDs monotonic after clearing a lane", () => {
  const store = fixture().open();
  const first = store.append(input);
  store.appendNotice(source, "poke", { sub_type: "poke" });
  const last = store.append(input);
  const latest = store.timeline(source, 2);
  expect(latest.map((entry) => entry.key)).toEqual([`message:${last.id}`, "event:poke"]);
  expect(store.timeline(source, 2, latest.at(-1)!.sequence).map((entry) => entry.key)).toEqual([`message:${first.id}`]);
  store.clear(source);
  expect(store.timeline(source, 20)).toEqual([]);
  expect(Number(store.append(input).id)).toBeGreaterThan(Number(last.id));
});

test("restores the latest visible entry of each conversation after restart, including notice-only lanes", () => {
  const f = fixture();
  const first = f.open();
  const group = { ...source, chatType: AgentChannelChatTypes.Group, chatId: "300" };
  const recalled = first.append(input);
  first.recall(recalled.id, source, "recall", { post_type: "notice", notice_type: "friend_recall" });
  const latestMessage = first.append(input);
  first.appendNotice(group, "poke-only", { post_type: "notice", sub_type: "poke", time: 123 });
  first.close();
  const reopened = f.open();
  const latest = reopened.latestConversations();
  expect([...latest.values()]).toMatchObject([
    { key: "event:poke-only", notice: { sub_type: "poke" } },
    { key: `message:${latestMessage.id}`, messageId: latestMessage.id },
  ]);
  reopened.clear(group);
  expect([...reopened.latestConversations().values()]).toMatchObject([{ messageId: latestMessage.id }]);
});

test("rolls back the recall tombstone when its notice cannot be committed", () => {
  const store = fixture().open();
  const message = store.append(input, task);
  store.appendNotice(source, "duplicate", { sub_type: "poke" });
  expect(() => store.recall(message.id, source, "duplicate", { notice_type: "friend_recall" })).toThrow();
  expect(store.isRecalled(message.id)).toBe(false);
  expect(store.history(source, 20)).toHaveLength(1);
});

test("binds an admitted event only within its actual conversation", () => {
  const store = fixture().open();
  store.appendNotice(source, "poke", { sub_type: "poke" });
  store.bind({ ...source, chatId: "other" }, "event:poke", task);
  expect(store.task("event:poke")).toBeUndefined();
  store.bind(source, "event:poke", task);
  expect(store.task("event:poke")).toEqual(task);
});

test("upgrades existing message rows once without inventing old task ownership", () => {
  const f = fixture();
  const legacy = new DatabaseSync(f.file);
  legacy.exec(
    "CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,lane TEXT NOT NULL,scene_type TEXT NOT NULL,scene_id TEXT NOT NULL,payload TEXT NOT NULL)",
  );
  legacy
    .prepare("INSERT INTO messages(lane,scene_type,scene_id,payload) VALUES(?,?,?,?)")
    .run(
      serializeAgentChannelLane(source),
      source.chatType,
      source.chatId,
      JSON.stringify({ ...input, sentAt: "2026-10-24T16:01:00.000Z" }),
    );
  legacy.close();
  const upgraded = f.open();
  expect(upgraded.timeline(source, 20)).toHaveLength(1);
  expect(upgraded.task("message:1")).toBeUndefined();
  upgraded.close();
  const reopened = f.open();
  expect(reopened.timeline(source, 20)).toHaveLength(1);
  expect(reopened.get("1")?.sentAt).toBe("2026-10-24T16:01:00.000Z");
});

test("incremental cursors cross complete pages, retain recalls and persist reset generations", () => {
  const f = fixture();
  const store = f.open();
  const first = store.append(input);
  const start = store.cursor(source);
  for (let index = 0; index < 205; index++) store.append(input);
  store.recall(first.id, source, "recall-gap", { notice_type: "friend_recall", message_id: Number(first.id) });
  store.appendNotice(source, "poke-gap", { sub_type: "poke" });
  const highWater = store.cursor(source);
  const page = store.timelineAfter(source, start.sequence, highWater.sequence, 200);
  const tail = store.timelineAfter(source, page.at(-1)!.sequence, highWater.sequence, 200);
  expect(page).toHaveLength(200);
  expect(tail).toHaveLength(7);
  expect(tail.slice(-2).map((row) => row.key)).toEqual(["event:recall-gap", "event:poke-gap"]);
  expect(new Set([...page, ...tail].map((row) => row.sequence)).size).toBe(207);
  expect(store.timelineAfter(source, highWater.sequence, highWater.sequence, 200)).toEqual([]);
  store.invalidateSnapshot(source);
  expect(store.revision(source)).toBe(0);
  expect(store.cursor(source).revision).toBe(1);
  store.clear(source);
  store.close();
  expect(f.open().cursor(source)).toEqual({ revision: 2, sequence: 0 });
});

test("accepted send tombstones survive removal, clear and restart without holding message bytes", () => {
  const f = fixture();
  const store = f.open();
  const receipt = { id: "client-id", digest: "body-digest" };
  const message = store.append(input, task, receipt);
  expect(() => store.append(input, undefined, receipt)).toThrow();
  expect(store.history(source, 20)).toHaveLength(1);
  store.removeRequests(task.sessionId, [task.requestId]);
  store.clear(source);
  store.close();
  const reopened = f.open();
  expect(reopened.clientSend(receipt.id)).toEqual({ digest: receipt.digest, messageId: message.id });
  expect(reopened.history(source, 20)).toEqual([]);
});

test("migrates the persisted clear generation without losing its value", () => {
  const f = fixture();
  const legacy = new DatabaseSync(f.file);
  legacy.exec("CREATE TABLE timeline_revisions(lane TEXT PRIMARY KEY,revision INTEGER NOT NULL)");
  legacy.prepare("INSERT INTO timeline_revisions VALUES(?,?)").run(serializeAgentChannelLane(source), 7);
  legacy.close();
  expect(f.open().cursor(source).revision).toBe(7);
});
