import { describe, expect, test, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  AgentChannelHttpError,
  type AgentChannelHttpRequestOptions,
  type AgentChannelHttpTransport,
} from "../../../Source/AgentSystem/Channels/AgentChannelHttpTransport.js";
import { AgentTelegramChannelAdapter } from "../../../Source/AgentSystem/Channels/Adapters/AgentTelegramChannelAdapter.js";
import { AgentQqChannelAdapter } from "../../../Source/AgentSystem/Channels/Adapters/AgentQqChannelAdapter.js";
import type { AgentChannelInboundMessage } from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";

type FakeTransportResponse = { status?: number; body?: unknown; bytes?: Uint8Array; contentType?: string };

type FakeTransportEntry =
  | FakeTransportResponse
  | ((url: string, options?: AgentChannelHttpRequestOptions) => FakeTransportResponse | Promise<FakeTransportResponse>);

function fakeTransport(script: FakeTransportEntry[]): AgentChannelHttpTransport & {
  calls: string[];
  requests: Array<{ url: string; options?: AgentChannelHttpRequestOptions }>;
} {
  const calls: string[] = [];
  const requests: Array<{ url: string; options?: AgentChannelHttpRequestOptions }> = [];
  return {
    calls,
    requests,
    async request(url: string, options?: AgentChannelHttpRequestOptions) {
      calls.push(`${options?.method ?? "GET"} ${url}`);
      requests.push({ url, options });
      const entry =
        script.length === 1 && typeof script[0] === "function"
          ? script[0]
          : (script.shift() ?? { status: 200, body: {} });
      const response = typeof entry === "function" ? await entry(url, options) : entry;
      if (response.status && response.status >= 400) {
        throw new AgentChannelHttpError(`HTTP ${response.status}`, response.status, response.body);
      }
      return {
        status: response.status ?? 200,
        body: response.body ?? {},
        bytes: response.bytes,
        contentType: response.contentType,
      };
    },
  };
}

describe("telegram adapter", () => {
  test("validates the token and processes a polled update into an inbound message", async () => {
    const transport = fakeTransport([
      { body: { ok: true, result: { id: 1, is_bot: true, first_name: "senera" } } },
      {
        body: {
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 5,
                chat: { id: 123, type: "private" },
                from: { id: 456, first_name: "Alex" },
                text: "hello",
              },
            },
          ],
        },
      },
      { body: { ok: true, result: [] } },
    ]);
    const received: AgentChannelInboundMessage[] = [];
    const adapter = new AgentTelegramChannelAdapter({
      token: "test:token",
      transport,
      pollIntervalMs: 0,
    });
    adapter.bind({
      onMessage: (message) => {
        received.push(message);
        return undefined;
      },
      onFatal: vi.fn(),
    });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(30);
    controller.abort();
    await adapter.disconnect();

    expect(transport.calls[0]).toContain("getMe");
    expect(received.length).toBe(1);
    expect(received[0].source.platform).toBe("telegram");
    expect(received[0].source.chatId).toBe("123");
    expect(received[0].source.userId).toBe("456");
    expect(received[0].text).toBe("hello");
  });

  test("degrades to plain text when MarkdownV2 send is rejected", async () => {
    const transport = fakeTransport([
      { status: 400, body: { ok: false, description: "bad parse" } },
      { body: { ok: true, result: { message_id: 9 } } },
    ]);
    const adapter = new AgentTelegramChannelAdapter({ token: "t", transport });
    adapter.bind({ onMessage: () => undefined, onFatal: () => undefined });
    const result = await adapter.send(
      { platform: "telegram", chatType: "direct", chatId: "1", userId: "2" },
      "**bold**",
    );
    expect(result).toMatchObject({ kind: "sent", messageId: "9" });
  });

  test("verifies the webhook secret token before processing a payload", async () => {
    const received: AgentChannelInboundMessage[] = [];
    const adapter = new AgentTelegramChannelAdapter({ token: "t", webhookSecret: "s3cret" });
    adapter.bind({
      onMessage: (message) => {
        received.push(message);
        return undefined;
      },
      onFatal: () => undefined,
    });

    await expect(
      adapter.handleWebhookUpdate(
        { message: { message_id: 1, chat: { id: 1, type: "private" }, from: { id: 2 }, text: "hi" }, update_id: 1 },
        "{}",
        { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
      ),
    ).rejects.toThrow();

    await adapter.handleWebhookUpdate(
      { update_id: 2, message: { message_id: 1, chat: { id: 1, type: "private" }, from: { id: 2 }, text: "hi" } },
      "{}",
      { "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
    );
    expect(received.length).toBe(1);
  });
});

describe("qq adapter", () => {
  function fakeGatewaySocket(): {
    socket: ReturnType<typeof createFakeSocket>;
    emit: (payload: unknown) => void;
    sent: Array<{ op?: number; d?: unknown }>;
  } {
    const socket = createFakeSocket();
    return { socket, emit: (payload) => socket.emit("message", JSON.stringify(payload)), sent: socket.sent };
  }

  test("connects via gateway websocket, subscribes dispatches, and sends text", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { url: "wss://sandbox.api.sgroup.qq.com" } },
      { body: { id: "msg-1" } },
    ]);
    const { socket, emit, sent } = fakeGatewaySocket();
    const received: AgentChannelInboundMessage[] = [];
    const states: string[] = [];
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      transport,
      createGatewaySocket: () => socket as never,
    });
    adapter.bind({
      onMessage: (message) => {
        received.push(message);
      },
      onFatal: vi.fn(),
      onConnectionStateChanged: (state) => states.push(state),
    });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(30);
    emit({ op: 10, d: { heartbeat_interval: 40000 } });
    await delay(30);

    const identify = sent.find((frame) => frame.op === 2);
    expect(identify).toBeDefined();
    expect((identify?.d as { token?: string })?.token).toBe("QQBot tok");
    expect(transport.calls.some((call) => call.includes("/gateway"))).toBe(true);
    expect(states).toContain("connecting");

    emit({ op: 0, t: "READY", s: 1, d: { session_id: "session-1" } });
    await delay(30);
    expect(states).toContain("connected");

    emit({
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      s: 2,
      d: { id: "m1", content: "你好", author: { user_openid: "openid-1" } },
    });
    await delay(30);
    expect(received).toHaveLength(1);
    expect(received[0]?.source.platform).toBe("qq");
    expect(received[0]?.source.chatType).toBe("direct");
    expect(received[0]?.source.userId).toBe("openid-1");

    const result = await adapter.send(
      { platform: "qq", chatType: "direct", chatId: "openid-1", userId: "openid-1" },
      "回复你",
    );
    expect(result).toMatchObject({ kind: "sent", messageId: "msg-1" });
    expect(transport.calls.some((call) => call.includes("/v2/users/openid-1/messages"))).toBe(true);

    controller.abort();
    await adapter.disconnect();
  });

  test("accepts browser-style EventTarget gateway sockets", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { url: "wss://sandbox.api.sgroup.qq.com" } },
    ]);
    const { socket, emit, sent } = createFakeEventTargetSocket();
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      transport,
      createGatewaySocket: () => socket as never,
      maxReconnectAttempts: 1,
    });
    adapter.bind({ onMessage: () => undefined, onFatal: vi.fn() });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(20);
    emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 40_000 } }));
    await delay(20);
    emit(
      "message",
      JSON.stringify({
        op: 0,
        t: "READY",
        s: 1,
        d: { session_id: "event-target-session" },
      }),
    );
    await delay(20);

    expect(sent.find((frame) => frame.op === 2)).toBeDefined();
    expect(adapter.getConnectionState()).toBe("connected");
    controller.abort();
    await adapter.disconnect();
  });

  test("accepts a RESUMED dispatch with a null body when resuming a live session", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { url: "wss://sandbox.api.sgroup.qq.com" } },
    ]);
    const { socket, emit, sent } = fakeGatewaySocket();
    const fatals: string[] = [];
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      transport,
      createGatewaySocket: () => socket as never,
      reconnectBackoffBaseMs: 10,
    });
    adapter.bind({ onMessage: () => undefined, onFatal: (error) => fatals.push(describeError(error)) });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(30);
    emit({ op: 10, d: { heartbeat_interval: 40_000 } });
    await delay(20);
    emit({ op: 0, t: "READY", s: 1, d: { session_id: "sess-1" } });
    await delay(30);
    expect(adapter.getConnectionState()).toBe("connected");

    socket.close();
    await delay(60);
    emit({ op: 10, d: { heartbeat_interval: 40_000 } });
    await delay(20);

    const resume = sent.find((frame) => frame.op === 6);
    expect((resume?.d as { session_id?: string })?.session_id).toBe("sess-1");
    emit({ op: 0, t: "RESUMED", s: 2, d: null });
    await delay(30);

    expect(adapter.getConnectionState()).toBe("connected");
    expect(fatals.some((message) => message.includes("did not establish"))).toBe(false);
    controller.abort();
    await adapter.disconnect();
  });

  test("cools down and retries with a fresh session after a quick-disconnect burst", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { url: "wss://sandbox.api.sgroup.qq.com" } },
    ]);
    const { socket, emit, sent } = fakeGatewaySocket();
    const fatals: string[] = [];
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      transport,
      createGatewaySocket: () => socket as never,
      reconnectBackoffBaseMs: 5,
      maxQuickDisconnects: 2,
      quickDisconnectCooldownMs: 40,
    });
    adapter.bind({ onMessage: () => undefined, onFatal: (error) => fatals.push(describeError(error)) });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(30);
    emit({ op: 10, d: { heartbeat_interval: 40_000 } });
    await delay(20);
    emit({ op: 0, t: "READY", s: 1, d: { session_id: "sess-1" } });
    await delay(30);

    socket.close();
    await delay(40);
    socket.close();
    await delay(100);

    const breaker = fatals.find((message) => message.includes("quick disconnects"));
    expect(breaker).toBeDefined();
    expect(breaker).toContain("fresh session");
    expect(fatals.some((message) => message.includes("QQ gateway stopped"))).toBe(false);

    emit({ op: 10, d: { heartbeat_interval: 40_000 } });
    await delay(20);
    expect(sent.filter((frame) => frame.op === 2)).toHaveLength(2);
    expect(sent.some((frame) => frame.op === 6)).toBe(false);
    emit({ op: 0, t: "READY", s: 3, d: { session_id: "sess-2" } });
    await delay(30);
    expect(adapter.getConnectionState()).toBe("connected");
    controller.abort();
    await adapter.disconnect();
  });

  test("established sessions refresh the quick-disconnect budget", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { url: "wss://sandbox.api.sgroup.qq.com" } },
    ]);
    const { socket, emit, sent } = fakeGatewaySocket();
    const fatals: string[] = [];
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      transport,
      createGatewaySocket: () => socket as never,
      reconnectBackoffBaseMs: 5,
      maxQuickDisconnects: 2,
      quickDisconnectCooldownMs: 40,
    });
    adapter.bind({ onMessage: () => undefined, onFatal: (error) => fatals.push(describeError(error)) });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(30);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      socket.close();
      await delay(30);
      emit({ op: 10, d: { heartbeat_interval: 40_000 } });
      await delay(20);
      if (cycle === 0) {
        emit({ op: 0, t: "READY", s: 1, d: { session_id: "sess-1" } });
      } else {
        emit({ op: 0, t: "RESUMED", s: cycle + 1, d: null });
      }
      await delay(30);
    }

    expect(adapter.getConnectionState()).toBe("connected");
    expect(sent.filter((frame) => frame.op === 6)).toHaveLength(2);
    expect(fatals.some((message) => message.includes("quick disconnects"))).toBe(false);
    controller.abort();
    await adapter.disconnect();
  });

  test("maps group @-messages to group lanes and strips the mention", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { url: "wss://sandbox.api.sgroup.qq.com" } },
    ]);
    const { socket, emit } = fakeGatewaySocket();
    const received: AgentChannelInboundMessage[] = [];
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      transport,
      createGatewaySocket: () => socket as never,
    });
    adapter.bind({
      onMessage: (message) => {
        received.push(message);
        return undefined;
      },
      onFatal: vi.fn(),
    });
    const controller = new AbortController();
    await adapter.connect(controller.signal);
    await delay(30);
    emit({ op: 10, d: { heartbeat_interval: 40000 } });
    await delay(30);

    emit({
      op: 0,
      t: "GROUP_AT_MESSAGE_CREATE",
      s: 3,
      d: {
        id: "g1",
        content: "<@!openid-1> 帮我查天气",
        group_openid: "group-9",
        author: { user_openid: "openid-1" },
      },
    });
    await delay(40);
    expect(received).toHaveLength(1);
    expect(received[0]?.source.chatType).toBe("group");
    expect(received[0]?.source.chatId).toBe("group-9");
    expect(received[0]?.text).toBe("帮我查天气");

    controller.abort();
    await adapter.disconnect();
  });

  test("revalidates the token on a 401 and resends", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok1", expires_in: 7200 } },
      { status: 401, body: {} },
      { body: { access_token: "tok2", expires_in: 7200 } },
      { body: { id: "msg-2" } },
    ]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      transport,
    });
    await adapter.connect(new AbortController().signal);
    const result = await adapter.send(
      { platform: "qq", chatType: "group", chatId: "group-1", userId: "openid-2" },
      "hi",
    );
    expect(result).toMatchObject({ kind: "sent", messageId: "msg-2" });
    expect(transport.calls.filter((call) => call.includes("getAppAccessToken")).length).toBeGreaterThan(1);
    await adapter.disconnect();
  });

  test("webhook mode verifies HMAC signatures and rejects mismatches", async () => {
    const transport = fakeTransport([{ body: { access_token: "tok", expires_in: 7200 } }]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      webhookSecret: "qsec",
      transport,
    });
    await adapter.connect(new AbortController().signal);

    const body = JSON.stringify({ s: 1, d: {} });
    const headers = {
      "X-Tsign-Open-Nonce": "nonce123",
      "X-Tsign-Open-Timestamp": "1720000000",
      "X-Tsign-Open-Signature": "c2ln",
    };
    await expect(adapter.handleWebhookUpdate({ s: 200002, d: {} }, body, headers)).rejects.toThrow();

    const message = "nonce123\n1720000000\n" + body;
    const signature = createHmac("sha256", "qsec").update(message, "utf8").digest("base64");
    const accepted = await adapter.handleWebhookUpdate(
      {
        s: 200002,
        d: { id: "w1", content: "hi", author: { user_openid: "openid-3" } },
      },
      body,
      { ...headers, "X-Tsign-Open-Signature": signature },
    );
    expect(accepted).toBe(true);
    await adapter.disconnect();
  });

  test("answers QQ webhook verification challenges with a signed response", async () => {
    const transport = fakeTransport([{ body: { access_token: "tok", expires_in: 7200 } }]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      transport,
    });
    await adapter.connect(new AbortController().signal);

    const challenge = {
      op: 13,
      d: { plain_token: "plain-token", event_ts: "1720000000" },
    };
    const response = await adapter.handleWebhookVerification(challenge, JSON.stringify(challenge), {});
    const expected = createHmac("sha256", "sec").update("1720000000plain-token", "utf8").digest("hex");
    expect(response).toMatchObject({ status: 200, body: { plain_token: "plain-token", signature: expected } });
    await adapter.disconnect();
  });

  test("sends native Markdown with a callback keyboard and preserves the reply id", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { id: "keyboard-message" } },
    ]);
    const adapter = new AgentQqChannelAdapter({ appId: "app", appSecret: "sec", mode: "webhook", transport });
    await adapter.connect(new AbortController().signal);

    const result = await adapter.sendWithKeyboard(
      { platform: "qq", chatType: "direct", chatId: "user-1", userId: "user-1", messageId: "inbound-1" },
      "**需要确认**\n\n继续执行？",
      { rows: [[{ id: "allow", label: "允许", data: "approve:a:allow-once" }]] },
    );

    expect(result).toMatchObject({ kind: "sent", messageId: "keyboard-message" });
    const request = transport.requests.at(-1);
    const body = jsonBody(request?.options?.body);
    expect(body).toMatchObject({ msg_type: 2, msg_id: "inbound-1" });
    expect((body?.markdown as { content?: string })?.content).toContain("**需要确认**");
    expect((body?.keyboard as { content?: { rows?: unknown[] } })?.content?.rows).toHaveLength(1);
    const button = (body?.keyboard as { content?: { rows?: Array<{ buttons?: unknown[] }> } })?.content?.rows?.[0]
      ?.buttons?.[0] as { action?: { type?: number; data?: string } };
    expect(button.action).toMatchObject({ type: 1, data: "approve:a:allow-once" });
    await adapter.disconnect();
  });

  test("falls back to plain text formatting when native Markdown is disabled", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { id: "plain-message" } },
    ]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      markdownSupport: false,
      transport,
    });
    await adapter.connect(new AbortController().signal);
    await adapter.send(
      { platform: "qq", chatType: "direct", chatId: "user-1", userId: "user-1" },
      "**粗体** 和 `代码`",
    );
    const body = jsonBody(transport.requests.at(-1)?.options?.body);
    expect(body).toMatchObject({ msg_type: 0, content: "粗体 和 代码" });
    expect(body?.markdown).toBeUndefined();
    await adapter.disconnect();
  });

  test("caches a URL media upload and emits a native rich-media message", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { file_info: "file-info-1" } },
      { body: { id: "media-message-1" } },
      { body: { id: "media-message-2" } },
    ]);
    const adapter = new AgentQqChannelAdapter({ appId: "app", appSecret: "sec", mode: "webhook", transport });
    await adapter.connect(new AbortController().signal);
    const source = { platform: "qq" as const, chatType: "direct" as const, chatId: "user-1", userId: "user-1" };
    await adapter.sendMediaMessage(
      source,
      { kind: "image", url: "https://cdn.example/image.png", contentType: "image/png" },
      "预览",
    );
    await adapter.sendMediaMessage(source, {
      kind: "image",
      url: "https://cdn.example/image.png",
      contentType: "image/png",
    });

    expect(transport.calls.filter((call) => call.includes("/files")).length).toBe(1);
    const mediaMessages = transport.requests.filter((request) => request.url.includes("/messages"));
    expect(mediaMessages).toHaveLength(2);
    expect(jsonBody(mediaMessages[0]?.options?.body)).toMatchObject({
      msg_type: 7,
      content: "预览",
      media: { file_info: "file-info-1" },
    });
    expect(jsonBody(mediaMessages[1]?.options?.body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "file-info-1" },
    });
    await adapter.disconnect();
  });

  test("uploads SVG media as a named QQ file", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { file_info: "svg-file-info" } },
      { body: { id: "svg-message" } },
    ]);
    const adapter = new AgentQqChannelAdapter({ appId: "app", appSecret: "sec", mode: "webhook", transport });
    await adapter.connect(new AbortController().signal);
    const source = { platform: "qq" as const, chatType: "direct" as const, chatId: "user-svg", userId: "user-svg" };
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>';

    await adapter.sendMediaMessage(source, {
      kind: "image",
      data: Buffer.from(svg).toString("base64"),
      contentType: "image/svg+xml",
      filename: "tihao-bike.svg",
    });

    const upload = transport.requests.find((request) => request.url.endsWith("/v2/users/user-svg/files"));
    expect(jsonBody(upload?.options?.body)).toMatchObject({
      file_type: 4,
      file_name: "tihao-bike.svg",
      srv_send_msg: false,
    });
    const message = transport.requests.find((request) => request.url.endsWith("/v2/users/user-svg/messages"));
    expect(jsonBody(message?.options?.body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "svg-file-info" },
    });
    await adapter.disconnect();
  });

  test("keeps text before media for a single mixed adapter call", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      { body: { id: "mixed-text" } },
      { body: { file_info: "file-info-mixed" } },
      { body: { id: "mixed-media" } },
    ]);
    const adapter = new AgentQqChannelAdapter({ appId: "app", appSecret: "sec", mode: "webhook", transport });
    await adapter.connect(new AbortController().signal);
    const source = { platform: "qq" as const, chatType: "direct" as const, chatId: "user-mixed", userId: "user-mixed" };

    await adapter.send(source, "说明文字\n第二行", {
      media: [{ kind: "image", url: "https://cdn.example/mixed.png", contentType: "image/png" }],
      chatType: source.chatType,
    });

    const messages = transport.requests.filter((request) => request.url.includes("/messages"));
    expect(messages).toHaveLength(2);
    expect(jsonBody(messages[0]?.options?.body)).toMatchObject({
      msg_type: 2,
      markdown: { content: "说明文字\n第二行" },
    });
    expect(jsonBody(messages[1]?.options?.body)).toMatchObject({
      msg_type: 7,
      media: { file_info: "file-info-mixed" },
    });
    expect(jsonBody(messages[1]?.options?.body)?.content).toBeUndefined();
    await adapter.disconnect();
  });

  test("uploads oversized in-memory media through prepare, signed parts, and complete", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      {
        body: {
          upload_id: "upload-1",
          block_size: 2,
          parts: [
            { part_index: 1, presigned_url: "https://cos.example/part-1" },
            { part_index: 2, presigned_url: "https://cos.example/part-2" },
          ],
        },
      },
      (url) =>
        url.startsWith("https://cos.example/")
          ? { body: {} }
          : url.includes("upload_part_finish")
            ? { body: {} }
            : url.includes("/files")
              ? { body: { file_info: "file-info-large" } }
              : { body: { id: "large-message" } },
    ]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      inlineMediaLimitBytes: 1,
      uploadConcurrency: 2,
      transport,
    });
    await adapter.connect(new AbortController().signal);
    await adapter.sendMediaMessage(
      { platform: "qq", chatType: "group", chatId: "group-1", userId: "user-1" },
      { kind: "file", data: Buffer.from("abcd").toString("base64"), filename: "report.txt", contentType: "text/plain" },
    );

    expect(transport.calls.filter((call) => call.includes("upload_prepare")).length).toBe(1);
    expect(transport.calls.filter((call) => call.startsWith("PUT https://cos.example/")).length).toBe(2);
    expect(transport.calls.filter((call) => call.includes("upload_part_finish")).length).toBe(2);
    expect(transport.calls.filter((call) => call.endsWith("/v2/groups/group-1/files")).length).toBe(1);
    await adapter.disconnect();
  });

  test("ACKs an interaction before handing it to the session control plane", async () => {
    const transport = fakeTransport([{ body: { access_token: "tok", expires_in: 7200 } }, { body: {} }]);
    const adapter = new AgentQqChannelAdapter({ appId: "app", appSecret: "sec", mode: "webhook", transport });
    const received: string[] = [];
    adapter.bind({
      onMessage: () => undefined,
      onFatal: vi.fn(),
      onInteraction: async (interaction) => {
        received.push(interaction.buttonData ?? "");
        expect(transport.calls.at(-1)).toContain("/interactions/interaction-1");
      },
    });
    await adapter.connect(new AbortController().signal);
    const interactionBody = "{}";
    await adapter.handleWebhookUpdate(
      {
        t: "INTERACTION_CREATE",
        d: {
          id: "interaction-1",
          chat_type: 2,
          user_openid: "user-1",
          data: { type: 11, resolved: { button_id: "allow", button_data: "approve:a:allow-once" } },
        },
      },
      interactionBody,
      qqWebhookHeaders(interactionBody, "sec"),
    );
    expect(jsonBody(transport.requests.at(-1)?.options?.body)).toEqual({ code: 0 });
    expect(received).toEqual(["approve:a:allow-once"]);
    await adapter.disconnect();
  });

  test("normalizes quoted text, protocol-relative media, voice metadata, and de-duplicates delivery", async () => {
    const transport = fakeTransport([{ body: { access_token: "tok", expires_in: 7200 } }]);
    const adapter = new AgentQqChannelAdapter({ appId: "app", appSecret: "sec", mode: "webhook", transport });
    const received: AgentChannelInboundMessage[] = [];
    adapter.bind({
      onMessage: (message) => {
        received.push(message);
      },
      onFatal: vi.fn(),
    });
    await adapter.connect(new AbortController().signal);
    const payload = {
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "quoted-1",
        content: "继续",
        author: { user_openid: "user-1" },
        message_type: "103",
        msg_elements: [
          {
            content: "之前的上下文",
            attachments: [{ url: "//cdn.example/voice.amr", content_type: "voice", asr_refer_text: "引用语音" }],
          },
        ],
      },
    };
    const payloadBody = JSON.stringify(payload);
    await adapter.handleWebhookUpdate(payload, payloadBody, qqWebhookHeaders(payloadBody, "sec"));
    await adapter.handleWebhookUpdate(payload, payloadBody, qqWebhookHeaders(payloadBody, "sec"));
    expect(received).toHaveLength(1);
    expect(received[0]?.text).toContain("[引用消息]");
    expect(received[0]?.text).toContain("之前的上下文");
    expect(received[0]?.attachments?.[0]).toMatchObject({
      url: "https://cdn.example/voice.amr",
      mediaType: "audio",
      transcript: "引用语音",
      contentType: "audio/amr",
    });
    await adapter.disconnect();
  });

  test("sends QQ input-notify only for direct lanes and debounces it", async () => {
    const transport = fakeTransport([{ body: { access_token: "tok", expires_in: 7200 } }, { body: {} }]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      transport,
      typingDebounceMs: 60_000,
    });
    adapter.bind({ onMessage: () => undefined, onFatal: vi.fn() });
    await adapter.connect(new AbortController().signal);
    const payload = {
      t: "C2C_MESSAGE_CREATE",
      d: { id: "typing-source", content: "hi", author: { user_openid: "user-1" } },
    };
    const payloadBody = JSON.stringify(payload);
    await adapter.handleWebhookUpdate(payload, payloadBody, qqWebhookHeaders(payloadBody, "sec"));
    const source = { platform: "qq" as const, chatType: "direct" as const, chatId: "user-1", userId: "user-1" };
    await adapter.sendTyping(source);
    await adapter.sendTyping(source);
    const typing = transport.requests.filter((request) => request.url.includes("/messages"));
    expect(typing).toHaveLength(1);
    expect(jsonBody(typing[0]?.options?.body)).toMatchObject({
      msg_type: 6,
      msg_id: "typing-source",
      input_notify: { input_type: 1, input_second: 60 },
    });
    await adapter.sendTyping({ platform: "qq", chatType: "group", chatId: "group-1", userId: "user-1" });
    expect(transport.requests.filter((request) => request.url.includes("/v2/groups/group-1/messages"))).toHaveLength(0);
    await adapter.disconnect();
  });

  test("transcribes QQ audio with a configured OpenAI-compatible STT endpoint", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      {
        bytes: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
        contentType: "audio/wav",
      },
      (url, options) => {
        expect(url).toBe("https://stt.example/v1/audio/transcriptions");
        expect(options?.method).toBe("POST");
        expect(options?.headers?.Authorization).toBe("Bearer stt-key");
        expect(options?.body).toBeInstanceOf(Uint8Array);
        return { body: { text: "你好，世界" } };
      },
    ]);
    const received: AgentChannelInboundMessage[] = [];
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      transport,
      stt: {
        provider: "openai",
        apiKey: "stt-key",
        baseUrl: "https://stt.example/v1",
        model: "whisper-1",
      },
    });
    adapter.bind({
      onMessage: (message) => {
        received.push(message);
      },
      onFatal: vi.fn(),
    });
    await adapter.connect(new AbortController().signal);

    const payload = {
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "voice-1",
        content: "请听语音",
        author: { user_openid: "user-voice" },
        attachments: [{ url: "https://cdn.example/voice.wav", content_type: "audio/wav" }],
      },
    };
    const rawBody = JSON.stringify(payload);
    await adapter.handleWebhookUpdate(payload, rawBody, qqWebhookHeaders(rawBody, "sec"));
    await delay(0);

    expect(received).toHaveLength(1);
    expect(received[0]?.attachments?.[0]?.transcript).toBe("你好，世界");
    expect(
      transport.requests.find((request) => request.url === "https://cdn.example/voice.wav")?.options?.headers
        ?.Authorization,
    ).toBe("QQBot tok");
    const sttRequest = transport.requests.find((request) => request.url.includes("/audio/transcriptions"));
    expect(sttRequest?.options?.body).toBeInstanceOf(Uint8Array);
    const multipartText = new TextDecoder().decode(sttRequest?.options?.body as Uint8Array);
    expect(multipartText).toContain('name="model"');
    expect(multipartText).toContain("whisper-1");
    expect(multipartText).toContain('name="file"; filename="qq-voice.wav"');
    await adapter.disconnect();
  });

  test("keeps all long keyboard text while attaching the keyboard only to the first chunk", async () => {
    const transport = fakeTransport([
      { body: { access_token: "tok", expires_in: 7200 } },
      (_url, _options) => ({ body: { id: `message-${transport.requests.length}` } }),
    ]);
    const adapter = new AgentQqChannelAdapter({
      appId: "app",
      appSecret: "sec",
      mode: "webhook",
      maxMessageLength: 12,
      transport,
    });
    await adapter.connect(new AbortController().signal);
    const content = "第一段文本\n第二段文本\n第三段文本\n第四段文本";
    await adapter.sendWithKeyboard(
      { platform: "qq", chatType: "direct", chatId: "user-long", userId: "user-long" },
      content,
      { rows: [[{ id: "ok", label: "确认", data: "command:status" }]] },
    );

    const messages = transport.requests
      .filter((request) => request.url.includes("/v2/users/user-long/messages"))
      .map((request) => jsonBody(request.options?.body));
    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0]?.keyboard).toBeDefined();
    expect(messages.slice(1).every((message) => message?.keyboard === undefined)).toBe(true);
    const rendered = messages
      .map(
        (message) => (message?.markdown as { content?: string } | undefined)?.content ?? String(message?.content ?? ""),
      )
      .join("");
    expect(rendered).toContain("第一段文本");
    expect(rendered).toContain("第二段文本");
    expect(rendered).toContain("第三段文本");
    expect(rendered).toContain("第四段文本");
    await adapter.disconnect();
  });
});

function createFakeSocket(): {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
  emit: (event: string, payload: unknown) => void;
  send: (data: string) => void;
  close: () => void;
  terminate: () => void;
  sent: Array<{ op?: number; d?: unknown }>;
} {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    sent: [] as Array<{ op?: number; d?: unknown }>,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, payload: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    send: (data: string) => {
      try {
        socket.sent.push(JSON.parse(data) as { op?: number; d?: unknown });
      } catch {
        // binary or malformed frames are ignored in tests
      }
    },
    close: () => {
      for (const listener of listeners.get("close") ?? []) listener();
    },
    terminate: () => {
      for (const listener of listeners.get("close") ?? []) listener();
    },
  };
  return socket;
}

function createFakeEventTargetSocket(): {
  socket: {
    binaryType: "arraybuffer";
    on?: undefined;
    off?: undefined;
    addEventListener: (event: string, listener: (value: unknown) => void) => void;
    removeEventListener: (event: string, listener: (value: unknown) => void) => void;
    send: (data: string) => void;
    close: (code?: number) => void;
    terminate: () => void;
  };
  emit: (event: string, value?: unknown) => void;
  sent: Array<{ op?: number; d?: unknown }>;
} {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const sent: Array<{ op?: number; d?: unknown }> = [];
  const socket = {
    binaryType: "arraybuffer" as const,
    addEventListener: (event: string, listener: (value: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeEventListener: (event: string, listener: (value: unknown) => void) => {
      listeners.get(event)?.delete(listener);
    },
    send: (data: string) => {
      try {
        sent.push(JSON.parse(data) as { op?: number; d?: unknown });
      } catch {
        // Ignore malformed frames in the test double.
      }
    },
    close: (code = 1000) => {
      emit("close", { code, reason: "" });
    },
    terminate: () => {
      emit("close", { code: 1006, reason: "terminated" });
    },
  };
  const emit = (event: string, value?: unknown): void => {
    const eventValue = event === "message" ? { data: value } : value;
    for (const listener of listeners.get(event) ?? []) listener(eventValue);
  };
  return { socket, emit, sent };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonBody(value: string | Uint8Array | undefined): Record<string, unknown> | undefined {
  if (typeof value !== "string") return undefined;
  return JSON.parse(value) as Record<string, unknown>;
}

function qqWebhookHeaders(rawBody: string, secret: string): Record<string, string> {
  const nonce = "test-nonce";
  const timestamp = "1720000000";
  const signature = createHmac("sha256", secret).update(`${nonce}\n${timestamp}\n${rawBody}`, "utf8").digest("base64");
  return {
    "X-Tsign-Open-Nonce": nonce,
    "X-Tsign-Open-Timestamp": timestamp,
    "X-Tsign-Open-Signature": signature,
  };
}
