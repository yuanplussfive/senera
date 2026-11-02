import { describe, expect, test, afterEach, vi } from "vitest";
import { agentErrorMessage } from "../../../Source/AgentSystem/I18n/AgentMessageCatalog.js";
import { AgentChannelSessionMappingStore } from "../../../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import {
  resolveAgentChannelSessionId,
  serializeAgentChannelLane,
} from "../../../Source/AgentSystem/Channels/AgentChannelSessionIdentity.js";
import {
  analyzeChannelMarkdownStructure,
  convertAgentChannelMarkdown,
  splitAgentChannelContent,
  splitChannelTextByParagraphs,
  ensureClosedFences,
} from "../../../Source/AgentSystem/Channels/AgentChannelText.js";
import {
  AgentChannelDelivery,
  createFloodError,
  isFloodControlError,
} from "../../../Source/AgentSystem/Channels/AgentChannelDelivery.js";
import {
  AgentChannelRunRenderer,
  AgentChannelRunRendererDefaults,
} from "../../../Source/AgentSystem/Channels/AgentChannelRunRenderer.js";
import { createAgentChannelActivity } from "../../../Source/AgentSystem/Channels/AgentChannelActivity.js";
import type {
  AgentChannelAdapter,
  AgentChannelSource,
} from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import { agentChannelMediaIdentity } from "../../../Source/AgentSystem/Channels/AgentChannelOutboundMedia.js";
import { cleanupChannelsTestRoots, openChannelsTestDatabase, TestChannelSource } from "./AgentChannelTestSupport.js";
import { createDeferred } from "../Support/AsyncTestFixtures.js";

afterEach(() => cleanupChannelsTestRoots());

describe("channel session identity", () => {
  test("resolves deterministic session ids per lane and epoch", () => {
    const first = resolveAgentChannelSessionId(TestChannelSource, 1);
    const again = resolveAgentChannelSessionId(TestChannelSource, 1);
    expect(again).toBe(first);
    expect(resolveAgentChannelSessionId(TestChannelSource, 2)).not.toBe(first);
    expect(resolveAgentChannelSessionId({ ...TestChannelSource, chatId: "other" }, 1)).not.toBe(first);
  });

  test("lane serialization is stable and thread-aware", () => {
    expect(serializeAgentChannelLane(TestChannelSource)).toContain("telegram:direct:111111111:222222222");
    const withThread = serializeAgentChannelLane({ ...TestChannelSource, threadId: "t1" });
    expect(withThread).toContain(":t1");
    expect(withThread).not.toBe(serializeAgentChannelLane(TestChannelSource));
  });
});

describe("channel session mapping store", () => {
  test("upsert, reset and resume paths", () => {
    const database = openChannelsTestDatabase();
    const store = new AgentChannelSessionMappingStore(database.connection);
    const now = "2026-09-03T00:00:00.000Z";

    const sessionId = resolveAgentChannelSessionId(TestChannelSource, 1);
    store.upsert(TestChannelSource, sessionId, 1, now);
    expect(store.getByLane(TestChannelSource)?.sessionId).toBe(sessionId);
    expect(store.getBySession(sessionId)?.chatId).toBe(TestChannelSource.chatId);

    const next = resolveAgentChannelSessionId(TestChannelSource, 2);
    store.resetEpoch(TestChannelSource, next, 2, now);
    expect(store.getByLane(TestChannelSource)?.sessionId).toBe(next);
    expect(store.getByLane(TestChannelSource)?.epoch).toBe(2);

    store.upsert(TestChannelSource, next, 2, now);
    expect(store.getByLane(TestChannelSource)?.epoch).toBe(2);
    database.close();
  });
});

describe("channel text pipeline", () => {
  test("splits long content at boundaries and keeps fences closed", () => {
    const long = "行".repeat(500);
    const chunks = splitAgentChannelContent(`${long}\nend`, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100 + 1);
      expect((chunk.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });

  test("closes an unterminated code fence", () => {
    const chunk = ensureClosedFences("```ts\nconst a = 1");
    expect(chunk.endsWith("```")).toBe(true);
    expect(ensureClosedFences("```ts\n```")).toBe("```ts\n```");
  });

  test("escapes Telegram MarkdownV2 specials and preserves code blocks", () => {
    const converted = convertAgentChannelMarkdown("*bold* and `code`\n```ts\nconst x = 1 * 2\n```", "markdown_v2");
    expect(converted).toContain("\\*bold\\*");
    expect(converted).toContain("const x = 1 * 2");
  });

  test("analyzes markdown structure for code, media, and resource evidence", () => {
    expect(analyzeChannelMarkdownStructure("")).toEqual({
      codeBlockCount: 0,
      codeLanguages: [],
      mediaReferenceCount: 0,
      resourceLinkCount: 0,
      plainLinkCount: 0,
      inlineResourceUriCount: 0,
    });
    const fenced = analyzeChannelMarkdownStructure("```ts\nconst x = 1;\n```\n    indented block");
    expect(fenced.codeBlockCount).toBe(2);
    expect(fenced.codeLanguages).toEqual(["ts"]);
    const media = analyzeChannelMarkdownStructure(
      "看图 ![截图](https://cdn.example/a.png) 和 [下载](E:/senera/archive.zip)",
    );
    expect(media.mediaReferenceCount).toBe(1);
    expect(media.resourceLinkCount).toBe(1);
    expect(media.plainLinkCount).toBe(0);
    const mixed = analyzeChannelMarkdownStructure("见 senera://resource/r1 和 [官网](https://example.com)");
    expect(mixed.inlineResourceUriCount).toBe(1);
    expect(mixed.plainLinkCount).toBe(1);
    const oversized = analyzeChannelMarkdownStructure("x".repeat(600_000));
    expect(oversized.codeBlockCount).toBeGreaterThan(0);
  });

  test("splits plain text into paragraph parts capped at four, balancing lengths", () => {
    expect(splitChannelTextByParagraphs("   ")).toEqual([]);
    expect(splitChannelTextByParagraphs("只有一段")).toEqual(["只有一段"]);
    expect(splitChannelTextByParagraphs("一。\n\n二。\n\n三。")).toEqual(["一。", "二。", "三。"]);
    const many = Array.from({ length: 8 }, (_, index) => `第${index + 1}段内容`).join("\n\n");
    const parts = splitChannelTextByParagraphs(many, 4);
    expect(parts.length).toBe(4);
    const lengths = parts.map((part) => part.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(2);
  });

  test("falls back to line blocks when text has breaks but no blank lines", () => {
    expect(splitChannelTextByParagraphs("第一行\n第二行\n第三行")).toEqual(["第一行", "第二行", "第三行"]);
  });
});

describe("channel delivery pump", () => {
  const recordingAdapter = (
    history: { source: AgentChannelSource; content: string; attempt: number }[],
    behavior?: {
      failAttempts?: number;
      delay?: (attempt: number) => number;
    },
  ): AgentChannelAdapter => {
    let calls = 0;
    return {
      kind: "telegram",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: true,
        supportsDraft: false,
        markdown: "markdown_v2",
        commandPrefix: "/",
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content) => {
        calls += 1;
        history.push({ source: _source, content, attempt: calls });
        if (behavior?.failAttempts && calls <= behavior.failAttempts) {
          throw createFloodError("flood", behavior.delay ? behavior.delay(calls) : 0);
        }
        return { kind: "sent", messageId: String(calls) };
      },
      handleWebhookUpdate: async () => false,
    };
  };

  test("preserves order and retries flood errors until success", async () => {
    const history: { source: AgentChannelSource; content: string; attempt: number }[] = [];
    const delivery = new AgentChannelDelivery({
      adapter: recordingAdapter(history, { failAttempts: 1, delay: () => 0 }),
      floodRetryMultiplierMs: 1,
    });
    delivery.enqueue(TestChannelSource, "first");
    delivery.enqueue(TestChannelSource, "second");
    await delivery.flush();
    expect(new Set(history.map((entry) => entry.content))).toEqual(new Set(["first", "second"]));
    await delivery.stop();
  });

  test("reports the original failure and media metadata for dropped sends", async () => {
    const failure = Object.assign(new Error("QQ media upload failed"), { retryable: false });
    let dropped:
      | {
          content: string;
          source: AgentChannelSource;
          error: unknown;
          mediaCount: number;
        }
      | undefined;
    const adapter = recordingAdapter([]);
    adapter.send = async () => {
      throw failure;
    };
    const delivery = new AgentChannelDelivery({
      adapter,
      onDropped: (content, source, error, options) => {
        dropped = { content, source, error, mediaCount: options?.media?.length ?? 0 };
      },
    });
    delivery.enqueue(TestChannelSource, "", {
      chatType: TestChannelSource.chatType,
      media: [{ kind: "file", path: "C:/tmp/image.svg", contentType: "image/svg+xml" }],
    });
    await delivery.flush();

    expect(dropped).toMatchObject({
      content: "",
      source: TestChannelSource,
      error: failure,
      mediaCount: 1,
    });
    await delivery.stop();
  });

  test("resolves a failure receipt instead of reporting a false success", async () => {
    const failure = Object.assign(new Error("media upload failed"), { retryable: false });
    const adapter = recordingAdapter([]);
    adapter.send = async () => {
      throw failure;
    };
    const delivery = new AgentChannelDelivery({ adapter });

    const receipt = delivery.enqueueAndWait(TestChannelSource, "payload");
    await expect(receipt).resolves.toMatchObject({
      status: "failed",
      code: "retry_exhausted",
      attempts: 1,
      error: failure,
    });
    await delivery.stop();
  });

  test("resolves queued work as stopped when the lane is closed", async () => {
    let release: (() => void) | undefined;
    const adapter = recordingAdapter([]);
    adapter.send = () =>
      new Promise((resolve) => {
        release = () => resolve({ kind: "sent", messageId: "late" });
      });
    const delivery = new AgentChannelDelivery({ adapter });
    const active = delivery.enqueueAndWait(TestChannelSource, "active");
    const queued = delivery.enqueueAndWait(TestChannelSource, "queued");
    delivery.stop();
    await expect(queued).resolves.toMatchObject({ status: "failed", code: "stopped" });
    release?.();
    await expect(active).resolves.toMatchObject({ status: "failed", code: "delivery_unknown" });
  });
});

describe("channel run renderer", () => {
  const events = (kinds: string[]): Array<{ kind: string; context?: object; data?: object }> =>
    kinds.map((kind) => ({ kind, context: { requestId: "req-1", sessionId: "s1" }, data: {} }));

  test("renders a stream: delta preview and final answer", async () => {
    const messages: { content: string; edit?: boolean }[] = [];
    const adapter: AgentChannelAdapter = {
      kind: "telegram",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: true,
        supportsDraft: false,
        markdown: "markdown_v2",
        commandPrefix: "/",
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content) => {
        messages.push({ content });
        return { kind: "sent", messageId: `m${messages.length}` };
      },
      edit: async (_source, messageId, content) => {
        messages.push({ content, edit: true });
        return { kind: "edited", messageId };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source: TestChannelSource,
      editIntervalMs: 0,
      bufferThreshold: 1,
    });

    for (const event of [
      events(["run.started"])[0],
      { ...events(["model.delta"])[0], data: { text: "你" } },
      { ...events(["model.delta"])[0], data: { text: "好" } },
      { ...events(["model.delta"])[0], data: { text: "世界" } },
      events(["run.completed"])[0],
    ]) {
      await renderer.handleEvent(event as never);
    }
    renderer.dispose();
    await delivery.flush();

    expect(messages.some((message) => message.content.includes("正在处理"))).toBe(false);
    expect(messages.some((message) => message.edit === true)).toBe(true);
    const edited = messages.filter((message) => message.edit === true).map((message) => message.content);
    expect(edited.some((content) => content.includes("你好世界"))).toBe(true);
    await delivery.stop();
  });

  test.each(["throw", "rejected"])(
    "sends the complete final answer when preview editing fails (%s)",
    async (failure) => {
      const adapter = editableAdapter();
      adapter.edit = vi.fn<NonNullable<AgentChannelAdapter["edit"]>>(async () => {
        if (failure === "throw") throw new Error("Preview is no longer editable.");
        return { kind: "unsupported" };
      });
      const delivery = new AgentChannelDelivery({ adapter });
      const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });
      try {
        await renderer.handleEvent(events(["run.started"])[0] as never);
        await renderer.handleEvent({ ...events(["model.delta"])[0], data: { text: "draft" } } as never);
        await renderer.handleEvent({
          ...events(["assistant.message.created"])[0],
          data: { kind: "final_answer", terminal: true, content: "Complete final answer" },
        } as never);
        await renderer.handleEvent(events(["run.completed"])[0] as never);
        expect(adapter.send).toHaveBeenLastCalledWith(
          TestChannelSource,
          "Complete final answer",
          expect.objectContaining({ deliveryId: expect.any(String) }),
        );
      } finally {
        renderer.dispose();
        await delivery.stop();
      }
    },
  );

  test("settles an in-flight preview edit before publishing the final answer", async () => {
    vi.useFakeTimers();
    const adapter = editableAdapter();
    const edited: string[] = [];
    const preview = createDeferred<void>();
    adapter.edit = vi.fn<NonNullable<AgentChannelAdapter["edit"]>>(async (_source, messageId, content) => {
      if (content === "ab") await preview.promise;
      edited.push(content);
      return { kind: "edited", messageId };
    });
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source: TestChannelSource,
      editIntervalMs: 10,
    });
    let completion: Promise<void> | undefined;
    try {
      await renderer.handleEvent(events(["run.started"])[0] as never);
      await renderer.handleEvent({ ...events(["model.delta"])[0], data: { text: "a" } } as never);
      await renderer.handleEvent({ ...events(["model.delta"])[0], data: { text: "b" } } as never);
      await vi.advanceTimersByTimeAsync(10);
      completion = renderer
        .handleEvent({
          ...events(["assistant.message.created"])[0],
          data: { kind: "final_answer", terminal: true, content: "final answer" },
        } as never)
        .then(() => renderer.handleEvent(events(["run.completed"])[0] as never));
      await vi.advanceTimersByTimeAsync(0);
      expect(adapter.edit).toHaveBeenCalledTimes(1);
      preview.resolve();
      await completion;
      expect(edited).toEqual(["ab", "final answer"]);
    } finally {
      preview.resolve();
      await completion;
      renderer.dispose();
      await delivery.stop();
      vi.useRealTimers();
    }
  });

  test("throttles large deltas and publishes the latest buffered preview", async () => {
    vi.useFakeTimers();
    const adapter = editableAdapter();
    adapter.edit = vi.fn<NonNullable<AgentChannelAdapter["edit"]>>(async (_source, messageId) => ({
      kind: "edited",
      messageId,
    }));
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source: TestChannelSource,
      editIntervalMs: 100,
      bufferThreshold: 1,
    });
    try {
      await renderer.handleEvent(events(["run.started"])[0] as never);
      for (const text of ["a", "b", "c"]) {
        await renderer.handleEvent({ ...events(["model.delta"])[0], data: { text } } as never);
      }
      expect(adapter.edit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(adapter.edit).toHaveBeenCalledExactlyOnceWith(TestChannelSource, "preview", "abc");
    } finally {
      renderer.dispose();
      await delivery.stop();
      vi.useRealTimers();
    }
  });

  test("continues delivering later events after one operation rejects", async () => {
    const adapter = editableAdapter();
    const delivery = new AgentChannelDelivery({ adapter });
    vi.spyOn(delivery, "enqueueAndWait").mockRejectedValueOnce(new Error("Delivery interrupted."));
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });
    try {
      await renderer.handleEvent(events(["run.started"])[0] as never);
      await expect(
        renderer.handleEvent({
          ...events(["assistant.message.created"])[0],
          data: { kind: "tool_preface", content: "Checking now" },
        } as never),
      ).rejects.toThrow("Delivery interrupted.");
      await renderer.handleEvent({
        ...events(["assistant.message.created"])[0],
        data: { kind: "final_answer", terminal: true, content: "Complete final answer" },
      } as never);
      await renderer.handleEvent(events(["run.completed"])[0] as never);
      expect(adapter.send).toHaveBeenCalledWith(
        TestChannelSource,
        "Complete final answer",
        expect.objectContaining({ deliveryId: expect.any(String) }),
      );
    } finally {
      renderer.dispose();
      await delivery.stop();
    }
  });

  test("delivers the model preface without exposing tool lifecycle events", async () => {
    const messages: string[] = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content) => {
        messages.push(content);
        return { kind: "sent", messageId: `m${messages.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-1" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-1" },
      data: { kind: "tool_preface", content: "我先查一下相关信息。", terminal: false },
    } as never);
    await renderer.handleEvent({
      kind: "tool.call.started",
      context: { requestId: "req-1" },
      data: { toolName: "WebSearch", callId: "call-1" },
    } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-1" },
      data: { kind: "final_answer", content: "查到了。", terminal: true },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-1" }, data: {} } as never);
    await delivery.flush();

    expect(messages).toEqual(["我先查一下相关信息。", "查到了。"]);
    expect(messages.some((content) => content.includes("正在处理"))).toBe(false);
    await delivery.stop();
  });

  test("keeps host failure notices on the deterministic delivery path", async () => {
    const sent: string[] = [];
    const channelAdapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content) => {
        sent.push(content);
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter: channelAdapter });
    const renderer = new AgentChannelRunRenderer({
      adapter: channelAdapter,
      delivery,
      source: TestChannelSource,
    });

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-failed" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "run.failed",
      context: { requestId: "req-failed" },
      data: { message: "upstream failed" },
    } as never);
    await delivery.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("upstream failed");
    await delivery.stop();
  });

  test("discards staged tool media when a run is cancelled", async () => {
    const sent: Array<{ content: string; options?: Parameters<AgentChannelAdapter["send"]>[2] }> = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
        supportsMedia: true,
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content, options) => {
        sent.push({ content, options });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-cancel" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "tool.call.result.detail",
      context: { requestId: "req-cancel" },
      data: { value: { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] } },
    } as never);
    await renderer.handleEvent({ kind: "run.cancelled", context: { requestId: "req-cancel" }, data: {} } as never);
    await delivery.flush();

    expect(sent).toEqual([
      {
        content: "已取消本次处理。",
        options: expect.objectContaining({ chatType: "direct", deliveryId: expect.any(String) }),
      },
    ]);
    await delivery.stop();
  });

  test("does not send tool result media without an assistant-authored media reference", async () => {
    const sent: Array<{ content: string; options?: Parameters<AgentChannelAdapter["send"]>[2] }> = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
        supportsMedia: true,
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content, options) => {
        sent.push({ content, options });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-tool-media" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "tool.call.result.detail",
      context: { requestId: "req-tool-media" },
      data: { value: { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] } },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-tool-media" }, data: {} } as never);
    await delivery.flush();

    expect(sent).toEqual([
      { content: "已完成。", options: expect.objectContaining({ chatType: "direct", deliveryId: expect.any(String) }) },
    ]);
    await delivery.stop();
  });

  test("delivers media only when an activity explicitly publishes it", async () => {
    const sent: Array<{ content: string; options?: Parameters<AgentChannelAdapter["send"]>[2] }> = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
        supportsMedia: true,
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content, options) => {
        sent.push({ content, options });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    await renderer.deliverActivity(
      createAgentChannelActivity({
        activityId: "activity-explicit-media",
        source: TestChannelSource,
        parts: [
          { kind: "text", content: "结果" },
          { kind: "media", media: { kind: "image", data: dataUri, contentType: "image/png" } },
        ],
        publication: { mode: "current_turn", resourceUris: [] },
      }),
    );
    await delivery.flush();

    expect(sent).toHaveLength(2);
    expect(sent[0]?.content).toBe("结果");
    expect(sent[0]?.options?.media).toBeUndefined();
    expect(sent[1]?.options?.media?.[0]).toMatchObject({
      kind: "image",
      contentType: "image/png",
      data: dataUri,
    });
    expect(sent[1]?.content).toBe("");
    await delivery.stop();
  });

  test("preserves text and explicitly published media order in the channel delivery stream", async () => {
    const sent: Array<{ content: string; options?: Parameters<AgentChannelAdapter["send"]>[2] }> = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
        supportsMedia: true,
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content, options) => {
        sent.push({ content, options });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });
    const image = "data:image/png;base64,iVBORw0KGgo=";
    await renderer.deliverActivity(
      createAgentChannelActivity({
        activityId: "activity-order",
        source: TestChannelSource,
        parts: [
          { kind: "text", content: "前文" },
          { kind: "media", media: { kind: "image", data: image, contentType: "image/png" } },
          { kind: "text", content: "后文" },
        ],
        publication: { mode: "current_turn", resourceUris: [] },
      }),
    );
    await delivery.flush();

    expect(sent).toHaveLength(3);
    expect(sent[0]?.content).toBe("前文");
    expect(sent[0]?.options?.media).toBeUndefined();
    expect(sent[1]?.content).toBe("");
    expect(sent[1]?.options?.media?.[0]?.kind).toBe("image");
    expect(sent[2]?.content).toBe("后文");
    expect(sent[2]?.options?.media).toBeUndefined();
    await delivery.stop();
  });

  test("sends one canonical MCP image when tool and answer reference the same resource", async () => {
    const sent: Array<{ content: string; options?: Parameters<AgentChannelAdapter["send"]>[2] }> = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
        supportsMedia: true,
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content, options) => {
        sent.push({ content, options });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const resolver = {
      resolve: async (resourceUri: string) => ({
        resourceUri,
        filePath: "E:/senera/.tmp/test-image.png",
        name: "test-image.png",
        mime: "image/png",
        size: 4,
        sha256: "a".repeat(64),
        origin: "artifact" as const,
      }),
    };
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source: TestChannelSource,
      resourceResolver: resolver,
    });
    await renderer.deliverActivity(
      createAgentChannelActivity({
        activityId: "activity-resource",
        source: TestChannelSource,
        parts: [
          {
            kind: "media",
            media: {
              kind: "image",
              resourceUri: "senera://resource/artifact-image",
              contentHash: "a".repeat(64),
              path: "E:/senera/.tmp/test-image.png",
              contentType: "image/png",
            },
          },
        ],
        publication: { mode: "current_turn", resourceUris: ["senera://resource/artifact-image"] },
      }),
    );
    await delivery.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.options?.media?.[0]).toMatchObject({ kind: "image", contentType: "image/png" });
    expect(sent[0]?.options?.media?.[0]).toMatchObject({ path: "E:/senera/.tmp/test-image.png" });
    await delivery.stop();
  });

  test("deduplicates explicitly published media representations by content hash", async () => {
    const sent: Array<{ content: string; options?: Parameters<AgentChannelAdapter["send"]>[2] }> = [];
    const adapter: AgentChannelAdapter = {
      kind: "qq",
      capabilities: {
        splitsLongMessages: true,
        maxMessageLength: 4096,
        supportsEdit: false,
        supportsDraft: false,
        markdown: "plain",
        commandPrefix: "/",
        supportsMedia: true,
      },
      bind: () => undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getConnectionState: () => "connected",
      send: async (_source, content, options) => {
        sent.push({ content, options });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const hash = "b".repeat(64);
    const media = {
      kind: "image" as const,
      resourceUri: "senera://resource/hash-image",
      contentHash: hash,
      path: "E:/senera/.tmp/hash-image.png",
      contentType: "image/png",
    };
    const renderer = new AgentChannelRunRenderer({ adapter, delivery, source: TestChannelSource });
    await renderer.deliverActivity(
      createAgentChannelActivity({
        activityId: "activity-dedup",
        source: TestChannelSource,
        parts: [
          { kind: "text", content: "结果" },
          { kind: "media", media },
          { kind: "media", media: { ...media, resourceUri: "senera://resource/alias" } },
        ],
        publication: {
          mode: "current_turn",
          resourceUris: ["senera://resource/hash-image", "senera://resource/alias"],
        },
      }),
    );
    await delivery.flush();

    expect(sent.filter((entry) => entry.options?.media?.length).length).toBe(1);
    expect(sent.filter((entry) => entry.content.trim() === "结果").length).toBe(1);
    expect(agentChannelMediaIdentity(media)).toBe(
      agentChannelMediaIdentity({
        kind: "image",
        contentHash: hash,
        path: "E:/senera/.tmp/hash-image.png",
        contentType: "image/png",
      }),
    );
    await delivery.stop();
  });
});

function editableAdapter(): AgentChannelAdapter {
  return {
    kind: "telegram",
    capabilities: {
      splitsLongMessages: true,
      maxMessageLength: 4096,
      supportsEdit: true,
      supportsDraft: false,
      markdown: "markdown_v2",
      commandPrefix: "/",
    },
    bind: () => undefined,
    connect: async () => undefined,
    disconnect: async () => undefined,
    getConnectionState: () => "connected",
    send: vi.fn<AgentChannelAdapter["send"]>(async () => ({ kind: "sent", messageId: "preview" })),
    handleWebhookUpdate: async () => false,
  };
}

test("identifies flood errors from the marker", () => {
  const error = createFloodError("flood", 3);
  expect(isFloodControlError(error)).toBe(true);
  expect(isFloodControlError(new Error("generic"))).toBe(false);
});

test("renderer defaults are explicit constants", () => {
  expect(AgentChannelRunRendererDefaults.editIntervalMs).toBeGreaterThan(0);
  expect(AgentChannelRunRendererDefaults.bufferThreshold).toBeGreaterThan(0);
  expect(AgentChannelRunRendererDefaults.toolProgressTemplate("WebSearch")).toBe(
    agentErrorMessage("channels.renderer.toolProgress", { tool: "WebSearch" }),
  );
});
