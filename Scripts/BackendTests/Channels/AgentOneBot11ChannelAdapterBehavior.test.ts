import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { describe, expect, test } from "vitest";
import { createTestAgentDirectory } from "../Support/AgentDirectoryTestFixture.js";
import { HostedOneBotTestAdapter as AgentOneBot11ChannelAdapter } from "../Support/HostedOneBotTestAdapter.js";
import { AgentChannelChatTypes, AgentChannelKinds } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import {
  AgentOneBot11MessageStore,
  agentOneBot11MessageStorePath,
} from "../../../Source/AgentSystem/Channels/Adapters/AgentOneBot11MessageStore.js";

type OneBotFrame = Record<string, unknown>;

describe("local OneBot 11 gateway", () => {
  test("coalesces client retries, restores receipts after restart and catches up every delta page", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-reliability-"));
    const store = new AgentOneBot11MessageStore(agentOneBot11MessageStorePath(runtimeDirectory));
    const adapter = new AgentOneBot11ChannelAdapter({
      directory: createTestAgentDirectory(),
      port: await reserveLoopbackPort(),
      selfId: 135791357,
      operatorId: 246802468,
      runtimeDirectory,
      messageStore: store,
      resolveOperatorDisplayName: () => "User",
    });
    const inbound: unknown[] = [];
    adapter.bind({
      onMessage: (message) => {
        inbound.push(message);
      },
      onFatal: (error) => {
        throw error;
      },
    });
    const source = {
      platform: AgentChannelKinds.OneBot11,
      chatType: AgentChannelChatTypes.Direct,
      chatId: "135791357",
      userId: "246802468",
    } as const;
    const params = { user_id: 135791357, message: "once", senera_client_message_id: randomUUID() };
    try {
      await adapter.connect(new AbortController().signal);
      let endpoint = adapter.getConnectionInfo()!.endpoint!;
      const [first, duplicate] = await Promise.all([
        postOneBotAction(endpoint, "send_private_msg", params),
        postOneBotAction(endpoint, "send_private_msg", params),
      ]);
      expect(first).toMatchObject({ status: "ok" });
      expect(duplicate).toEqual(first);
      await eventually(() => inbound.length === 1);
      const snapshot = await adapter.readClientTimeline(source);
      expect(snapshot.entries).toHaveLength(1);
      expect(await postOneBotAction(endpoint, "send_private_msg", { ...params, message: "changed" })).toMatchObject({
        status: "failed",
        echo: "test-action",
      });
      expect(
        await postOneBotAction(endpoint, "send_private_msg", { ...params, senera_client_message_id: "invalid" }),
      ).toMatchObject({ status: "failed", echo: "test-action" });
      await adapter.disconnect();
      await adapter.connect(new AbortController().signal);
      endpoint = adapter.getConnectionInfo()!.endpoint!;
      expect(await postOneBotAction(endpoint, "send_private_msg", params)).toEqual(first);
      expect(inbound).toHaveLength(1);
      for (let index = 0; index < 12; index++) await adapter.send(source, `reply ${index}`, { chatType: "direct" });
      await adapter.poke(source);
      let cursor = snapshot.sync!.cursor;
      const keys: string[] = [];
      for (;;) {
        const page = await adapter.readClientTimeline(source, undefined, 5, { after: cursor });
        expect(page.sync!.reset).toBe(false);
        keys.push(...page.entries.map((entry) => entry.key));
        cursor = page.sync!.cursor;
        if (!page.sync!.hasMore) break;
      }
      expect(keys).toHaveLength(13);
      expect(new Set(keys).size).toBe(13);
      expect((await adapter.readClientTimeline(source, undefined, 5, { after: cursor })).entries).toEqual([]);
      store.clear(source);
      const beforeReplay = inbound.length;
      expect(await postOneBotAction(endpoint, "send_private_msg", params)).toEqual(first);
      const reset = await adapter.readClientTimeline(source, undefined, 5, { after: cursor });
      expect(reset).toMatchObject({ entries: [], sync: { reset: true, cursor: { revision: 1, sequence: 0 } } });
      expect(inbound).toHaveLength(beforeReplay);
    } finally {
      await adapter.disconnect();
      store.close();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("persists group reactions and essence, broadcasts snapshots, and rejects invalid annotation targets", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-annotations-"));
    const filePath = agentOneBot11MessageStorePath(runtimeDirectory);
    const directory = createTestAgentDirectory();
    directory.importLegacyGroups([{ id: "900001", name: "Test group" }]);
    const adapter = new AgentOneBot11ChannelAdapter({
      directory,
      port: await reserveLoopbackPort(),
      selfId: 135791357,
      operatorId: 246802468,
      runtimeDirectory,
      resolveOperatorDisplayName: () => "Operator",
    });
    adapter.bind({
      onRecall: async () => undefined,
      onMessage: async () => undefined,
      onFatal: (error) => {
        throw error;
      },
    });
    let socket: WebSocket | undefined;
    try {
      await adapter.connect(new AbortController().signal);
      let endpoint = adapter.getConnectionInfo()!.endpoint!;
      socket = new WebSocket(endpoint);
      const frames = queueOneBotFrames(socket);
      await waitForSocketOpen(socket);
      const sent = await postOneBotAction(endpoint, "send_group_msg", {
        group_id: 900001,
        message: [
          { type: "text", data: { text: "Keep this" } },
          { type: "face", data: { id: 14 } },
        ],
      });
      const messageId = (sent.data as { message_id: number }).message_id;
      const conversations = await adapter.readClientConversations();
      expect(conversations).toMatchObject([
        {
          chatType: "group",
          chatId: "900001",
          name: "Test group",
          latest: { payload: { message_id: messageId, post_type: "message" } },
        },
      ]);
      const params = { message_id: String(messageId), group_id: 900001, emoji_id: "5" };
      const reaction = await postOneBotAction(endpoint, "set_msg_emoji_like", params);
      expect(reaction).toMatchObject({
        status: "ok",
        data: { emoji_like: [{ emoji_id: "5", count: 1 }], emojis: { "5": [246802468] } },
      });
      await expect(frames.next((frame) => frame.sub_type === "group_msg_emoji_like")).resolves.toMatchObject({
        group_id: 900001,
        message_id: messageId,
        extensions: reaction.data,
      });
      // Action retries and broadcast echoes never count the same person twice.
      expect(await postOneBotAction(endpoint, "set_msg_emoji_like", params)).toMatchObject({ data: reaction.data });
      expect(await postOneBotAction(endpoint, "set_essence_msg", { message_id: messageId })).toMatchObject({
        status: "ok",
        data: { is_essence: true },
      });
      const essence = await postOneBotAction(endpoint, "get_essence_msg_list", { group_id: 900001 });
      expect(essence).toMatchObject({
        status: "ok",
        data: [
          {
            message_id: messageId,
            sender_id: 246802468,
            operator_id: 246802468,
            content: [
              { type: "text", data: { text: "Keep this" } },
              { type: "face", data: { id: 14 } },
            ],
          },
        ],
      });
      await adapter.disconnect();
      // Verify the actual file through a fresh SQLite connection, not an in-memory cache.
      const reopened = new AgentOneBot11MessageStore(filePath);
      try {
        expect(reopened.annotations(String(messageId))).toMatchObject({
          emojis: { "5": [246802468] },
          is_essence: true,
        });
      } finally {
        reopened.close();
      }
      await adapter.connect(new AbortController().signal);
      endpoint = adapter.getConnectionInfo()!.endpoint!;
      expect(await adapter.readClientConversations()).toMatchObject([
        {
          chatId: "900001",
          latest: { key: `message:${messageId}`, payload: { message_id: messageId, is_essence: true } },
        },
      ]);
      expect(await postOneBotAction(endpoint, "get_msg", { message_id: messageId })).toMatchObject({
        data: { is_essence: true, emojis: { "5": [246802468] } },
      });
      expect(await postOneBotAction(endpoint, "get_group_msg_history", { group_id: 900001 })).toMatchObject({
        data: { messages: [{ is_essence: true, emojis: { "5": [246802468] } }] },
      });
      expect(await postOneBotAction(endpoint, "set_msg_emoji_like", { ...params, is_set: false })).toMatchObject({
        data: { emojis: {}, emoji_like: [] },
      });
      expect(await postOneBotAction(endpoint, "delete_essence_msg", { message_id: messageId })).toMatchObject({
        data: { is_essence: false },
      });
      expect(await postOneBotAction(endpoint, "get_essence_msg_list", { group_id: 900001 })).toMatchObject({
        data: [],
      });
      expect(
        await postOneBotAction(endpoint, "set_essence_msg", { message_id: messageId, group_id: 900002 }),
      ).toMatchObject({ status: "failed" });
      const direct = await postOneBotAction(endpoint, "send_private_msg", { user_id: 135791357, message: "Private" });
      expect(
        await postOneBotAction(endpoint, "set_msg_emoji_like", {
          ...params,
          message_id: (direct.data as { message_id: number }).message_id,
        }),
      ).toMatchObject({ status: "failed" });
      await postOneBotAction(endpoint, "delete_msg", { message_id: messageId });
      expect(await postOneBotAction(endpoint, "set_essence_msg", { message_id: messageId })).toMatchObject({
        status: "failed",
      });
    } finally {
      socket?.terminate();
      await adapter.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("replays native notices and recall originals after reconnect and removes every message belonging to a recalled task", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-timeline-"));
    const store = new AgentOneBot11MessageStore(agentOneBot11MessageStorePath(runtimeDirectory));
    const port = await reserveLoopbackPort();
    const selfId = 135791399;
    const operatorId = 246802499;
    const source = {
      platform: AgentChannelKinds.OneBot11,
      chatType: AgentChannelChatTypes.Direct,
      chatId: String(selfId),
      userId: String(operatorId),
    } as const;
    const task = { sessionId: "session", requestId: "request" };
    const adapter = new AgentOneBot11ChannelAdapter({
      port,
      selfId,
      operatorId,
      runtimeDirectory,
      messageStore: store,
      directory: createTestAgentDirectory("Assistant"),
      resolveOperatorDisplayName: () => "User",
    });
    adapter.bind({
      onMessage: (message) => {
        adapter.bindHistory(message.source, `message:${message.source.messageId}`, task);
      },
      onRecall: async () => {
        store.removeRequests(task.sessionId, [task.requestId]);
      },
      onFatal: (error) => {
        throw error;
      },
    });
    try {
      await adapter.connect(new AbortController().signal);
      const endpoint = adapter.getConnectionInfo()!.endpoint!;
      const sent = await postOneBotAction(endpoint, "send_private_msg", {
        user_id: selfId,
        message: [
          { type: "text", data: { text: "edit this" } },
          { type: "face", data: { id: 14 } },
        ],
      });
      const messageId = String((sent.data as { message_id: number }).message_id);
      await eventually(() => store.task(`message:${messageId}`) !== undefined);
      await adapter.send(source, "first reply", { chatType: source.chatType, task });
      await adapter.send(source, "second reply", { chatType: source.chatType, task });
      await adapter.poke(source, task);
      const before = await adapter.readClientTimeline(source);
      expect(before.entries).toHaveLength(4);
      expect(before.entries.at(-1)?.payload).toMatchObject({
        post_type: "notice",
        notice_type: "notify",
        sub_type: "poke",
      });
      expect(before.entries[0]?.payload).toMatchObject({
        sender: { user_id: operatorId },
        message: [
          { type: "text", data: { text: "edit this" } },
          { type: "face", data: { id: 14 } },
        ],
      });
      await adapter.disconnect();
      await adapter.connect(new AbortController().signal);
      expect((await adapter.readClientTimeline(source)).entries).toEqual(before.entries);
      const recalled = await postOneBotAction(adapter.getConnectionInfo()!.endpoint!, "delete_msg", {
        message_id: Number(messageId),
      });
      expect(recalled).toMatchObject({ status: "ok" });
      const after = await adapter.readClientTimeline(source);
      expect(after.entries).toHaveLength(1);
      expect(after.entries[0]?.payload).toMatchObject({
        post_type: "notice",
        notice_type: "friend_recall",
        message_id: Number(messageId),
        originMsg: { sender: { user_id: operatorId }, message: before.entries[0]?.payload.message },
      });
      await adapter.disconnect();
      await adapter.connect(new AbortController().signal);
      expect((await adapter.readClientTimeline(source)).entries).toEqual(after.entries);
    } finally {
      await adapter.disconnect();
      store.close();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("preserves virtual numeric identities across HTTP, WebSocket, inbound delivery, and explicit outbound delivery", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-"));
    const port = await reserveLoopbackPort();
    const selfId = 135_791_357;
    const operatorId = 246_802_468;
    const inbound: Array<{ readonly text: string }> = [];
    const fatal: unknown[] = [];
    const adapter = new AgentOneBot11ChannelAdapter({
      port,
      selfId,
      operatorId,
      runtimeDirectory,
      directory: createTestAgentDirectory(),
      resolveOperatorDisplayName: () => "Operator",
    });
    adapter.bind({
      onMessage: async (message) => {
        inbound.push({ text: message.text });
      },
      onFatal: (error) => fatal.push(error),
    });

    let socket: WebSocket | undefined;
    try {
      await adapter.connect(new AbortController().signal);
      const endpoint = adapter.getConnectionInfo()?.endpoint;
      expect(endpoint).toBe(`ws://127.0.0.1:${port}/socket`);
      await expect(readOneBotIdentity(runtimeDirectory)).resolves.toEqual({ selfId, operatorId });

      const login = await postOneBotAction(endpoint!, "get_login_info", {});
      expect(login).toMatchObject({
        status: "ok",
        retcode: 0,
        data: { user_id: operatorId, nickname: "Operator" },
      });
      await expect(postOneBotAction(endpoint!, "get_friend_list", {})).resolves.toMatchObject({
        data: [{ user_id: selfId, nickname: "Senera" }],
      });
      await expect(postOneBotAction(endpoint!, "get_version_info", {})).resolves.toMatchObject({
        status: "ok",
        retcode: 0,
        data: { app_name: "Senera Virtual OneBot Gateway", protocol_version: "v11" },
      });

      socket = new WebSocket(endpoint!);
      const frames = queueOneBotFrames(socket);
      await waitForSocketOpen(socket);
      await frames.next((frame) => frame.post_type === "meta_event" && frame.meta_event_type === "lifecycle");

      const inboundReceipt = frames.next((frame) => frame.echo === "inbound");
      socket.send(
        JSON.stringify({
          action: "send_private_msg",
          params: { user_id: selfId, message: "message from local client" },
          echo: "inbound",
        }),
      );
      const receipt = await inboundReceipt;
      expect(receipt).toMatchObject({ status: "ok", retcode: 0, data: { message_id: 1 }, echo: "inbound" });
      await eventually(() => inbound.some((message) => message.text === "message from local client"));

      const source = {
        platform: AgentChannelKinds.OneBot11,
        chatType: AgentChannelChatTypes.Direct,
        chatId: String(selfId),
        userId: String(operatorId),
      } as const;
      const outboundEvent = frames.next(
        (frame) => frame.post_type === "message" && frame.raw_message === "host-selected output",
      );
      const sent = await adapter.send(source, "host-selected output");
      const published = await outboundEvent;
      expect(sent).toEqual({ kind: "sent", messageId: "2" });
      if (sent.kind !== "sent") throw new Error("The virtual OneBot gateway did not return a sent-message receipt.");
      expect(published).toMatchObject({
        self_id: operatorId,
        user_id: selfId,
        message_id: 2,
        raw_message: "host-selected output",
      });
      expect(await adapter.readHistory(source)).toHaveLength(2);

      const recalled = frames.next((frame) => frame.notice_type === "friend_recall" && frame.message_id === 2);
      await adapter.deleteMessage(source, sent.messageId);
      await expect(recalled).resolves.toMatchObject({ self_id: operatorId, user_id: selfId });
      await expect(adapter.readHistory(source)).resolves.toHaveLength(1);
      expect(fatal).toEqual([]);
    } finally {
      socket?.close();
      await adapter.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("retains rich direct and group message segments, including inline media, for the channel pipeline", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-rich-"));
    const port = await reserveLoopbackPort();
    const selfId = 135_791_358;
    const operatorId = 246_802_469;
    const inbound: Array<Record<string, unknown>> = [];
    const directory = createTestAgentDirectory();
    directory.importLegacyGroups([{ id: "900001", name: "Test group" }]);
    const adapter = new AgentOneBot11ChannelAdapter({
      directory,
      port,
      selfId,
      operatorId,
      runtimeDirectory,
      resolveOperatorDisplayName: () => "Operator",
    });
    adapter.bind({
      onMessage: async (message) => {
        inbound.push(message as unknown as Record<string, unknown>);
      },
      onFatal: (error) => {
        throw error;
      },
    });

    try {
      await adapter.connect(new AbortController().signal);
      const endpoint = adapter.getConnectionInfo()?.endpoint;
      expect(endpoint).toBeDefined();
      const encodedImage = Buffer.from("onebot image payload").toString("base64");
      await expect(
        postOneBotAction(endpoint!, "send_group_msg", {
          group_id: 900_001,
          message: [
            { type: "text", data: { text: "请看 " } },
            { type: "at", data: { qq: selfId } },
            { type: "image", data: { file: `base64://${encodedImage}`, name: "sample.png" } },
            { type: "reply", data: { id: 42 } },
          ],
        }),
      ).resolves.toMatchObject({ status: "ok", retcode: 0 });

      await eventually(() => inbound.length === 1);
      expect(inbound[0]).toMatchObject({
        source: {
          platform: AgentChannelKinds.OneBot11,
          chatType: AgentChannelChatTypes.Group,
          chatId: "900001",
          userId: String(operatorId),
        },
        text: `请看 [CQ:at,qq=${selfId}][CQ:reply,id=42]`,
        replyToMessageId: "42",
      });
      expect(inbound[0]?.segments).toEqual([
        { type: "text", data: { text: "请看 " } },
        { type: "at", data: { qq: selfId } },
        {
          type: "image",
          data: {
            attachmentId: "onebot-segment-3",
            name: "sample.png",
            size: 20,
            file: expect.stringContaining(`http://127.0.0.1:${port}/media/`),
            url: expect.stringContaining(`http://127.0.0.1:${port}/media/`),
          },
        },
        { type: "reply", data: { id: 42 } },
      ]);
      expect(inbound[0]?.attachments).toEqual([
        {
          id: "onebot-segment-3",
          inlineData: { encoding: "base64", data: encodedImage },
          filename: "sample.png",
          mediaType: "image",
          size: 20,
        },
      ]);

      const source = {
        platform: AgentChannelKinds.OneBot11,
        chatType: AgentChannelChatTypes.Group,
        chatId: "900001",
        userId: String(operatorId),
      } as const;
      const history = await adapter.readHistory(source);
      expect(history).toHaveLength(1);
      expect(history[0]?.segments?.[2]).toMatchObject({
        type: "image",
        data: { name: "sample.png", url: expect.stringContaining(`http://127.0.0.1:${port}/`) },
      });
      const mediaUrl = history[0]?.segments?.[2]?.data.url;
      expect(typeof mediaUrl).toBe("string");
      const mediaResponse = await fetch(mediaUrl as string);
      expect(Buffer.from(await mediaResponse.arrayBuffer()).toString()).toBe("onebot image payload");

      await expect(
        adapter.send({ ...source, agentId: directory.get().id }, "已发送图片", {
          chatType: AgentChannelChatTypes.Group,
          media: [
            {
              kind: "image",
              url: "https://media.example.test/senera.png",
              filename: "senera.png",
              contentType: "image/png",
            },
          ],
        }),
      ).resolves.toMatchObject({ kind: "sent" });
      const outbound = (await adapter.readHistory(source))[0];
      expect(outbound?.segments).toEqual([
        { type: "text", data: { text: "已发送图片" } },
        {
          type: "image",
          data: {
            file: "https://media.example.test/senera.png",
            url: "https://media.example.test/senera.png",
            name: "senera.png",
            content_type: "image/png",
          },
        },
      ]);
    } finally {
      await adapter.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("preserves generated identities through restart and releases the runtime when its owner aborts", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-identity-"));
    const port = await reserveLoopbackPort();
    const controller = new AbortController();
    const first = createAdapter({ port, runtimeDirectory });
    const second = createAdapter({ port, runtimeDirectory });

    try {
      await first.connect(controller.signal);
      const firstId = first.getConnectionInfo()?.accountId;
      expect(firstId).toMatch(/^\d+$/u);
      controller.abort(new Error("test shutdown"));
      await eventually(() => first.getConnectionState() === "stopped");

      await second.connect(new AbortController().signal);
      expect(second.getConnectionInfo()?.accountId).toBe(firstId);
      await expect(readOneBotIdentity(runtimeDirectory)).resolves.toMatchObject({ operatorId: Number(firstId) });
    } finally {
      await first.disconnect();
      await second.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("pages durable history and only recalls outbound messages from their own conversation lane", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-history-"));
    const port = await reserveLoopbackPort();
    const adapter = createAdapter({ port, runtimeDirectory, selfId: 135_791_359, operatorId: 246_802_470 });
    const source = {
      platform: AgentChannelKinds.OneBot11,
      chatType: AgentChannelChatTypes.Direct,
      chatId: "135791359",
      userId: "246802470",
    } as const;
    const otherSource = { ...source, chatId: "another-lane" } as const;

    try {
      await adapter.connect(new AbortController().signal);
      for (let index = 1; index <= 201; index += 1) {
        await adapter.send(source, `entry ${index}`);
      }
      const history = await adapter.readHistory(source);
      expect(history).toHaveLength(200);
      expect(history[0]?.text).toBe("entry 201");
      expect(history.at(-1)?.text).toBe("entry 2");
      const protocolPage = await postOneBotAction(adapter.getConnectionInfo()!.endpoint!, "get_friend_msg_history", {
        user_id: Number(source.chatId),
        message_id: 0,
        count: 3,
      });
      expect(protocolPage).toMatchObject({
        data: { messages: [{ message_id: 199 }, { message_id: 200 }, { message_id: 201 }] },
      });
      await expect(adapter.readHistory(source, { beforeMessageId: history.at(-1)!.id })).resolves.toMatchObject([
        { text: "entry 1" },
      ]);

      const sent = await adapter.send(source, "only this lane may recall me");
      if (sent.kind !== "sent") throw new Error("Expected the virtual gateway to accept the outbound message.");
      await expect(
        adapter.send(otherSource, "wrong quote", { chatType: otherSource.chatType, replyToMessageId: sent.messageId }),
      ).rejects.toThrow("current OneBot conversation");
      await expect(
        adapter.send(source, "valid quote", { chatType: source.chatType, replyToMessageId: sent.messageId }),
      ).resolves.toMatchObject({ kind: "sent" });
      await expect(adapter.deleteMessage(otherSource, sent.messageId)).rejects.toThrow("current conversation");
      await expect(adapter.deleteMessage(source, sent.messageId)).resolves.toEqual({ kind: "deleted" });
    } finally {
      await adapter.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("restores message IDs, rich history, and recall ownership after reconnect", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-persistence-"));
    const port = await reserveLoopbackPort();
    const options = { port, runtimeDirectory, selfId: 135_791_360, operatorId: 246_802_471 };
    const first = createAdapter(options);
    const second = createAdapter(options);
    const source = {
      platform: AgentChannelKinds.OneBot11,
      chatType: AgentChannelChatTypes.Direct,
      chatId: String(options.selfId),
      userId: String(options.operatorId),
    };
    try {
      await first.connect(new AbortController().signal);
      const receipt = await first.send(source, "persistent message");
      expect(receipt).toMatchObject({ messageId: "1" });
      await first.disconnect();
      await second.connect(new AbortController().signal);
      await expect(second.readHistory(source)).resolves.toMatchObject([{ id: "1", text: "persistent message" }]);
      await expect(second.send(source, "after reconnect")).resolves.toMatchObject({ messageId: "2" });
      await second.deleteMessage(source, "1");
      await expect(second.readHistory(source)).resolves.toMatchObject([{ id: "2" }]);
    } finally {
      await first.disconnect();
      await second.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("does not silently replace corrupt identities and can cancel a pending connection", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-invalid-"));
    const port = await reserveLoopbackPort();
    const adapter = createAdapter({ port, runtimeDirectory });
    try {
      await writeFile(path.join(runtimeDirectory, "identity.json"), JSON.stringify({ selfId: 1, operatorId: 1 }));
      await expect(adapter.connect(new AbortController().signal)).rejects.toThrow("distinct positive integer");
      expect(adapter.getConnectionState()).toBe("degraded");
      expect(await readOneBotIdentity(runtimeDirectory)).toEqual({ selfId: 1, operatorId: 1 });
      await rm(path.join(runtimeDirectory, "identity.json"));
      const connecting = adapter.connect(new AbortController().signal);
      const disconnecting = adapter.disconnect();
      await Promise.all([connecting, disconnecting]);
      expect(adapter.getConnectionState()).toBe("stopped");
      await adapter.connect(new AbortController().signal);
      expect(adapter.getConnectionState()).toBe("connected");
    } finally {
      await adapter.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });

  test("isolates concurrent workspaces and reopens owned media on a changed gateway port", async () => {
    const firstDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-isolated-a-"));
    const secondDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-isolated-b-"));
    const firstPort = await reserveLoopbackPort();
    const secondPort = await reserveLoopbackPort();
    const identity = { selfId: 135_791_361, operatorId: 246_802_472 };
    const first = createAdapter({ port: firstPort, runtimeDirectory: firstDirectory, ...identity });
    const second = createAdapter({ port: secondPort, runtimeDirectory: secondDirectory, ...identity });
    const reopened = createAdapter({ port: firstPort, runtimeDirectory: secondDirectory, ...identity });
    const source = {
      platform: AgentChannelKinds.OneBot11,
      chatType: AgentChannelChatTypes.Direct,
      chatId: String(identity.selfId),
      userId: String(identity.operatorId),
    };
    const media = {
      kind: "image" as const,
      data: Buffer.from("isolated media bytes").toString("base64"),
      contentType: "image/png",
    };
    try {
      await Promise.all([first.connect(new AbortController().signal), second.connect(new AbortController().signal)]);
      await first.send(source, "workspace A");
      await second.send(source, "before after", {
        chatType: source.chatType,
        parts: [
          { kind: "text", content: "before" },
          { kind: "media", media },
          { kind: "text", content: "after" },
        ],
      });
      expect((await first.readHistory(source)).map((item) => item.text)).toEqual(["workspace A"]);
      const previous = (await second.readHistory(source))[0]!;
      expect(previous.segments?.map((item) => item.type)).toEqual(["text", "image", "text"]);
      const initial = await postOneBotAction(second.getConnectionInfo()!.endpoint!, "get_friend_msg_history", {
        user_id: identity.selfId,
        message_id: 0,
        count: 20,
      });
      expect(initial).toMatchObject({ data: { messages: [{ message_id: 1 }] } });
      await Promise.all([first.disconnect(), second.disconnect()]);
      await reopened.connect(new AbortController().signal);
      const record = (await reopened.readHistory(source))[0]!;
      const url = record.segments?.[1]?.data.url as string;
      expect(new URL(url).port).toBe(String(firstPort));
      expect(Buffer.from(await (await fetch(url)).arrayBuffer()).toString()).toBe("isolated media bytes");
      // Reusing the client's owned URL goes through the upload boundary, not a
      // private-network HTTP exception or an unreadable attachment placeholder.
      await expect(
        postOneBotAction(reopened.getConnectionInfo()!.endpoint!, "send_private_msg", {
          user_id: identity.selfId,
          message: [{ type: "image", data: { file: url } }],
        }),
      ).resolves.toMatchObject({ status: "ok" });
    } finally {
      await Promise.all([first.disconnect(), second.disconnect(), reopened.disconnect()]);
      await Promise.all([
        rm(firstDirectory, { recursive: true, force: true }),
        rm(secondDirectory, { recursive: true, force: true }),
      ]);
    }
  });

  test("rejects unreadable media without recording or delivering a stripped message", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "senera-onebot11-invalid-media-"));
    const adapter = createAdapter({
      port: await reserveLoopbackPort(),
      runtimeDirectory,
      selfId: 135_791_362,
      operatorId: 246_802_473,
    });
    const inbound: unknown[] = [];
    adapter.bind({
      onMessage: async (message) => {
        inbound.push(message);
      },
      onFatal: (error) => {
        throw error;
      },
    });
    try {
      await adapter.connect(new AbortController().signal);
      await expect(
        postOneBotAction(adapter.getConnectionInfo()!.endpoint!, "send_private_msg", {
          user_id: 135_791_362,
          message: [
            { type: "text", data: { text: "keep complete" } },
            { type: "image", data: { file: "unresolved-local-image.png" } },
          ],
        }),
      ).resolves.toMatchObject({ status: "failed", msg: expect.stringContaining("readable") });
      expect(inbound).toEqual([]);
      expect(
        await adapter.readHistory({
          platform: AgentChannelKinds.OneBot11,
          chatType: AgentChannelChatTypes.Direct,
          chatId: "135791362",
          userId: "246802473",
        }),
      ).toEqual([]);
    } finally {
      await adapter.disconnect();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });
});

function createAdapter(input: {
  readonly port: number;
  readonly runtimeDirectory: string;
  readonly selfId?: number;
  readonly operatorId?: number;
}): AgentOneBot11ChannelAdapter {
  const adapter = new AgentOneBot11ChannelAdapter({
    port: input.port,
    directory: createTestAgentDirectory(),
    runtimeDirectory: input.runtimeDirectory,
    selfId: input.selfId,
    operatorId: input.operatorId,
    resolveOperatorDisplayName: () => "Operator",
  });
  adapter.bind({
    onMessage: async () => undefined,
    onFatal: (error) => {
      throw error;
    },
  });
  return adapter;
}

function queueOneBotFrames(socket: WebSocket): {
  next(accept: (frame: OneBotFrame) => boolean): Promise<OneBotFrame>;
} {
  const pending: OneBotFrame[] = [];
  const waiters: Array<{
    readonly accept: (frame: OneBotFrame) => boolean;
    readonly resolve: (frame: OneBotFrame) => void;
  }> = [];
  socket.on("message", (data) => {
    const frame = JSON.parse(String(data)) as OneBotFrame;
    const index = waiters.findIndex((waiter) => waiter.accept(frame));
    if (index >= 0) {
      waiters.splice(index, 1)[0]?.resolve(frame);
      return;
    }
    pending.push(frame);
  });
  return {
    next: (accept) =>
      new Promise<OneBotFrame>((resolve, reject) => {
        const existingIndex = pending.findIndex(accept);
        if (existingIndex >= 0) {
          resolve(pending.splice(existingIndex, 1)[0]!);
          return;
        }
        const timeout = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === onResolve);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error("Timed out waiting for the expected OneBot frame."));
        }, 3_000);
        timeout.unref?.();
        const onResolve = (frame: OneBotFrame): void => {
          clearTimeout(timeout);
          resolve(frame);
        };
        waiters.push({ accept, resolve: onResolve });
      }),
  };
}

async function postOneBotAction(
  endpoint: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const socket = new WebSocket(endpoint);
  const frames = queueOneBotFrames(socket);
  try {
    await waitForSocketOpen(socket);
    socket.send(JSON.stringify({ action, params, echo: "test-action" }));
    return await frames.next((frame) => frame.echo === "test-action");
  } finally {
    socket.terminate();
  }
}

async function readOneBotIdentity(runtimeDirectory: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path.join(runtimeDirectory, "identity.json"), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The persisted OneBot identity is not an object.");
  }
  return value as Record<string, unknown>;
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      socket.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      socket.off("open", onOpen);
      reject(error);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    throw new Error("Could not reserve a loopback TCP port for the OneBot gateway test.");
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Expected asynchronous OneBot delivery did not occur.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
