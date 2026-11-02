import { afterEach, describe, expect, test } from "vitest";
import { AgentChannelsDatabase } from "../../../Source/AgentSystem/Channels/AgentChannelsDatabase.js";
import { AgentChannelParticipationStore } from "../../../Source/AgentSystem/Channels/AgentChannelParticipationStore.js";
import { matchesAgentChannelWait } from "../../../Source/AgentSystem/Channels/AgentChannelParticipation.js";
import type { AgentChannelSource } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { cleanupChannelsTestRoots, openChannelsTestDatabase } from "./AgentChannelTestSupport.js";

afterEach(cleanupChannelsTestRoots);

const source: AgentChannelSource = {
  platform: "onebot11",
  chatType: "group",
  chatId: "10",
  userId: "20",
  agentId: "agent-a",
};
function append(store: AgentChannelParticipationStore, id: string, text = id) {
  return store.append({ source: { ...source, messageId: id }, senderId: "20", text });
}

describe("durable channel participation", () => {
  test("a new participant starts at its joining dispatch while older records remain readable", () => {
    const database = openChannelsTestDatabase();
    try {
      const store = new AgentChannelParticipationStore(database.connection);
      append(store, "1", "earlier discussion");
      const joined = append(store, "2", "current discussion");
      store.ensure("session-a", source, joined.sequence - 1);
      expect([...store.pending("session-a")].map((entry) => entry.message.text)).toEqual(["current discussion"]);
      expect(store.read("session-a", 40, 0).entries.map((entry) => entry.message.text)).toEqual([
        "earlier discussion",
        "current discussion",
      ]);
      store.register("session-a", "initial", { events: ["mention"] });
      store.ensure("session-a", source);
      expect(store.get("session-a")?.status).toBe("waiting");
    } finally {
      database.close();
    }
  });

  test("wait conditions, pending wake identity and read cursor survive reopening", () => {
    let database = openChannelsTestDatabase();
    try {
      let store = new AgentChannelParticipationStore(database.connection);
      const event = append(store, "1");
      store.ensure("session-a", source);
      store.observe("session-a", event.sequence);
      const wait = store.register("session-a", "request-a", {
        events: ["mention", "poke"],
        senderIds: ["20"],
        wakeAt: "2026-10-26T10:00:00+08:00",
      });
      const next = append(store, "2");
      const ready = store.ready("session-a", "event", next.sequence);
      const file = database.connection.name;
      database.close();
      database = new AgentChannelsDatabase(file);
      store = new AgentChannelParticipationStore(database.connection);
      expect(store.get("session-a")).toMatchObject({
        status: "ready",
        cursor: event.sequence,
        waitId: wait.waitId,
        resumeRequestId: ready.resumeRequestId,
        pendingSequence: next.sequence,
        conditions: wait.conditions,
      });
      store.accept("session-a", ready.resumeRequestId!);
      store.accept("session-a", ready.resumeRequestId!);
      expect(store.get("session-a")).toMatchObject({
        status: "active",
        cursor: event.sequence,
        activeRequestId: ready.resumeRequestId,
      });
      expect([...store.pending("session-a")]).toEqual([]);
      expect(store.read("session-a", 40).entries.map((entry) => entry.sequence)).toEqual([next.sequence]);
    } finally {
      database.close();
    }
  });

  test("stop preserves the read cursor, discards pending activations and ignores a late old cancellation", () => {
    const database = openChannelsTestDatabase();
    try {
      const store = new AgentChannelParticipationStore(database.connection);
      store.ensure("session-a", source);
      const first = append(store, "1");
      const old = store.ready("session-a", "event", first.sequence);
      store.accept("session-a", old.resumeRequestId!);
      store.pause("session-a", old.resumeRequestId);
      expect(store.get("session-a")?.status).toBe("paused");
      const next = append(store, "2");
      store.ensure("session-a", source);
      const current = store.ready("session-a", "event", next.sequence);
      store.accept("session-a", current.resumeRequestId!);
      store.pause("session-a", old.resumeRequestId);
      expect(store.get("session-a")).toMatchObject({ status: "active", activeRequestId: current.resumeRequestId });
      expect(store.read("session-a", 40).entries).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  test("shared task boundaries retain a peer's records and remove a pending event when its last owner rewinds", () => {
    const database = openChannelsTestDatabase();
    try {
      const store = new AgentChannelParticipationStore(database.connection);
      store.ensure("session-a", source);
      store.ensure("session-b", { ...source, agentId: "agent-b" });
      const event = append(store, "1");
      store.bind(source, "message:1", { sessionId: "session-a", requestId: "request-a" });
      store.bind(source, "message:1", { sessionId: "session-b", requestId: "request-b" });
      store.register("session-b", "wait-request", { events: ["message"] });
      store.ready("session-b", "event", event.sequence);
      store.removeRequests("session-a", ["request-a"]);
      expect(store.read("session-b", 40).entries).toHaveLength(1);
      store.removeRequests("session-b", ["request-b"]);
      expect(store.read("session-b", 40).entries).toHaveLength(0);
      expect(store.get("session-b")).toMatchObject({ status: "paused" });
      expect(store.get("session-b")?.pendingSequence).toBeUndefined();
      expect(database.connection.prepare("SELECT count(*) AS count FROM channel_event_tasks").get()).toEqual({
        count: 0,
      });
    } finally {
      database.close();
    }
  });

  test("sender attention filters ambient activity while selected direct-contact events remain independent", () => {
    const database = openChannelsTestDatabase();
    try {
      const store = new AgentChannelParticipationStore(database.connection);
      store.ensure("session-a", source);
      store.register("session-a", "request-a", {
        events: ["message", "mention", "reply", "poke", "membership"],
        senderIds: ["20"],
      });
      const participant = store.get("session-a")!;
      const message = { source, text: "hello", senderId: "30" };
      expect(matchesAgentChannelWait(participant, message, "40")).toBe(false);
      expect(matchesAgentChannelWait(participant, { ...message, senderId: "20" }, "40")).toBe(true);
      expect(
        matchesAgentChannelWait(participant, { ...message, segments: [{ type: "at", data: { qq: "40" } }] }, "40"),
      ).toBe(true);
      expect(matchesAgentChannelWait(participant, { ...message, replyToSenderId: "40" }, "40")).toBe(true);
      const event = { id: "poke", type: "poke", actorId: "30", targetId: "40", sentAt: new Date().toISOString() };
      expect(matchesAgentChannelWait(participant, { ...message, event }, "40")).toBe(true);
      expect(
        matchesAgentChannelWait(participant, { ...message, event: { ...event, type: "member_joined" } }, "40"),
      ).toBe(false);
      expect(matchesAgentChannelWait(participant, { ...message, senderId: "40", replyToSenderId: "40" }, "40")).toBe(
        false,
      );
    } finally {
      database.close();
    }
  });

  test("native events match verified identities and never wake their actor", () => {
    const database = openChannelsTestDatabase();
    try {
      const store = new AgentChannelParticipationStore(database.connection);
      store.ensure("session-a", source);
      store.register("session-a", "request-a", { events: ["mention", "poke", "membership"] });
      const participant = store.get("session-a")!;
      const message = { source, text: "hello", senderId: "30", segments: [{ type: "at", data: { qq: "40" } }] };
      expect(matchesAgentChannelWait(participant, message, "40")).toBe(true);
      expect(matchesAgentChannelWait(participant, { ...message, senderId: "40" }, "40")).toBe(false);
      const poke = {
        source,
        text: "",
        event: { id: "poke", type: "poke", actorId: "30", targetId: "40", sentAt: new Date().toISOString() },
      };
      expect(matchesAgentChannelWait(participant, poke, "40")).toBe(true);
      expect(
        matchesAgentChannelWait(participant, { ...poke, event: { ...poke.event, type: "member_joined" } }, "40"),
      ).toBe(true);
      const waiting = store.get("session-a")!;
      append(store, "1");
      store.clear(source);
      expect(store.list()).toEqual([]);
      expect(() => store.read(waiting.sessionId, 40)).toThrow("no channel participation");
    } finally {
      database.close();
    }
  });
});
