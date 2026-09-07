import { describe, expect, test, afterEach } from "vitest";
import { agentErrorMessage } from "../../../Source/AgentSystem/I18n/AgentMessageCatalog.js";
import { AgentChannelSessionMappingStore } from "../../../Source/AgentSystem/Channels/AgentChannelSessionMappingStore.js";
import {
  resolveAgentChannelSessionId,
  serializeAgentChannelLane,
} from "../../../Source/AgentSystem/Channels/AgentChannelSessionIdentity.js";
import {
  analyzeChannelMarkdownStructure,
  convertAgentChannelMarkdown,
  requiresChannelFinalRewrite,
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
import type {
  AgentChannelAdapter,
  AgentChannelSource,
} from "../../../Source/AgentSystem/Channels/AgentChannelTypes.js";
import {
  agentChannelMediaIdentity,
  projectAgentChannelMediaFromValue,
  projectAgentChannelFinalParts,
  projectAgentChannelOutboundMedia,
} from "../../../Source/AgentSystem/Channels/AgentChannelOutboundMedia.js";
import { parseAgentChannelFinalDelivery } from "../../../Source/AgentSystem/Channels/AgentChannelFinalResponse.js";
import {
  appendAgentChannelFinalizationRecord,
  readAgentChannelFinalizationHistory,
} from "../../../Source/AgentSystem/Channels/AgentChannelFinalizationTypes.js";
import { cleanupChannelsTestRoots, openChannelsTestDatabase, TestChannelSource } from "./AgentChannelTestSupport.js";

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

describe("structured channel final delivery", () => {
  test("validates ordered parts without Markdown routing", async () => {
    const parts = parseAgentChannelFinalDelivery(
      JSON.stringify({
        parts: [
          { kind: "text", text: "前文" },
          { kind: "resource", uri: "senera://resource/image", alt: "截图" },
          { kind: "code", language: "svg", code: "<svg />" },
          { kind: "text", text: "后文" },
        ],
      }),
    );
    const projection = await projectAgentChannelFinalParts(parts, {
      resourceResolver: {
        resolve: async () => ({
          resourceUri: "senera://resource/image",
          filePath: "E:/senera/image.png",
          name: "image.png",
          mime: "image/png",
          size: 8,
          sha256: "a".repeat(64),
          origin: "artifact" as const,
        }),
      },
    });
    expect(projection.segments.map((segment) => segment.kind)).toEqual(["text", "media", "media", "text"]);
    expect(projection.media[1]).toMatchObject({ kind: "file", contentType: "image/svg+xml" });
  });
});

describe("channel finalization context", () => {
  test("keeps a bounded, idempotent learning window", () => {
    let metadata: Parameters<typeof appendAgentChannelFinalizationRecord>[0] | undefined;
    const base = {
      createdAt: "2026-09-03T00:00:00.000Z",
      platform: "qq" as const,
      chatType: "direct" as const,
      content: "x".repeat(20_000),
      parts: [
        { kind: "text" as const, text: "x".repeat(20_000) },
        { kind: "resource" as const, uri: "senera://resource/example", alt: "示例" },
      ],
    };
    for (let index = 0; index < 10; index += 1) {
      metadata = appendAgentChannelFinalizationRecord(metadata, { ...base, id: `request-${index}` });
    }
    metadata = appendAgentChannelFinalizationRecord(metadata, { ...base, id: "request-9", content: "latest" });

    const history = readAgentChannelFinalizationHistory(metadata);
    expect(history).toHaveLength(8);
    expect(history.map((record) => record.id)).toEqual([
      "request-2",
      "request-3",
      "request-4",
      "request-5",
      "request-6",
      "request-7",
      "request-8",
      "request-9",
    ]);
    expect(history.at(-1)?.content).toBe("latest");
    expect(history[0]?.content.length).toBeLessThanOrEqual(12_000);
    expect(history[0]?.parts[0]?.kind === "text" && history[0].parts[0].text.length).toBeLessThanOrEqual(8_192);
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

  test("requires a model rewrite for code fences and explicit resources", () => {
    expect(requiresChannelFinalRewrite("")).toBe(false);
    expect(requiresChannelFinalRewrite("纯文本回答，没有任何特殊内容。")).toBe(false);
    expect(requiresChannelFinalRewrite("行内 `code` 和普通链接 https://example.com 不算")).toBe(false);
    expect(requiresChannelFinalRewrite("普通链接 [官网](https://example.com) 不触发")).toBe(false);
    expect(requiresChannelFinalRewrite("```ts\nconst x = 1;\n```")).toBe(true);
    expect(requiresChannelFinalRewrite("前文\n~~~\ncode\n~~~")).toBe(true);
    expect(requiresChannelFinalRewrite("看图 ![截图](https://cdn.example/a.png)")).toBe(true);
    expect(requiresChannelFinalRewrite("见 senera://resource/r1")).toBe(true);
    expect(requiresChannelFinalRewrite("[下载](E:/senera/archive.zip)")).toBe(true);
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

  test("uses the host rewrite and preserves structured delivery order", async () => {
    const source: AgentChannelSource = { ...TestChannelSource, platform: "qq" };
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
    let rewriteInput:
      | {
          content: string;
          source: AgentChannelSource;
          context?: { resourceManifest?: { references: readonly unknown[] } };
        }
      | undefined;
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source,
      finalResponseRewriter: {
        rewrite: async (input) => {
          rewriteInput = input;
          return {
            parts: [
              { kind: "text", text: "前文" },
              { kind: "text", text: "中间" },
              { kind: "resource", uri: "data:image/png;base64,iVBORw0KGgo=", alt: "截图" },
              { kind: "code", language: "svg", code: "<svg />" },
              { kind: "text", text: "后文" },
            ],
          };
        },
      },
      resourceResolver: {
        resolve: async () => undefined,
        resolveWorkspacePath: async () => ({
          filePath: "C:/Users/1/Downloads/YaeMiko.svg",
          name: "YaeMiko.svg",
          mime: "image/svg+xml",
          size: 128,
          sha256: "e".repeat(64),
        }),
      },
    });

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-final" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-final" },
      data: {
        kind: "final_answer",
        content: "最终答案 ![截图](YaeMiko.svg)",
        terminal: true,
      },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-final" }, data: {} } as never);
    await delivery.flush();

    expect(rewriteInput).toMatchObject({ content: "最终答案 ![截图](YaeMiko.svg)", source: { platform: "qq" } });
    expect(rewriteInput?.context?.resourceManifest?.references).toEqual([
      {
        source: "YaeMiko.svg",
        kind: "workspace",
        absolutePath: "C:/Users/1/Downloads/YaeMiko.svg",
        name: "YaeMiko.svg",
        mime: "image/svg+xml",
      },
    ]);
    expect(sent.map(({ content }) => content)).toEqual(["前文", "中间", "", "", "后文"]);
    expect(sent[2]?.options?.media?.[0]).toMatchObject({ kind: "image", contentType: "image/png" });
    expect(sent[3]?.options?.media?.[0]).toMatchObject({ kind: "file", contentType: "image/svg+xml" });
    expect(sent.some(({ content }) => content.includes("!["))).toBe(false);
    await delivery.stop();
  });

  test("keeps plain-text answers on the local paragraph path", async () => {
    const source: AgentChannelSource = { ...TestChannelSource, platform: "qq" };
    const sent: Array<{ content: string }> = [];
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
      send: async (_s, content) => {
        sent.push({ content });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    let rewrites = 0;
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source,
      finalResponseRewriter: {
        rewrite: async () => {
          rewrites += 1;
          return {
            parts: [
              { kind: "text", text: "第一段纯文本。" },
              { kind: "text", text: "第二段纯文本。" },
              { kind: "text", text: "第三段纯文本。" },
            ],
          };
        },
      },
    });
    const answer = "第一段纯文本。\n\n第二段纯文本。\n\n第三段纯文本。";
    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-plain" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-plain" },
      data: { kind: "final_answer", content: answer, terminal: true },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-plain" }, data: {} } as never);
    await delivery.flush();

    expect(rewrites).toBe(0);
    expect(sent.map(({ content }) => content)).toEqual(["第一段纯文本。", "第二段纯文本。", "第三段纯文本。"]);
    await delivery.stop();
  });

  test("runs the host rewrite for structured answers with code fences", async () => {
    const source: AgentChannelSource = { ...TestChannelSource, platform: "qq" };
    const sent: Array<{ content: string }> = [];
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
      send: async (_s, content) => {
        sent.push({ content });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    let rewrites = 0;
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source,
      finalResponseRewriter: {
        rewrite: async () => {
          rewrites += 1;
          return {
            parts: [
              { kind: "text", text: "第一段" },
              { kind: "text", text: "第二段" },
            ],
          };
        },
      },
    });
    const answer = "前文\n```ts\nconst x = 1;\n```\n后文";
    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-long" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-long" },
      data: { kind: "final_answer", content: answer, terminal: true },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-long" }, data: {} } as never);
    await delivery.flush();

    expect(rewrites).toBe(1);
    expect(sent.map(({ content }) => content)).toEqual(["第一段", "第二段"]);
    await delivery.stop();
  });

  test("falls back to plain text when the rewrite produces an empty projection", async () => {
    const source: AgentChannelSource = { ...TestChannelSource, platform: "qq" };
    const sent: Array<{ content: string }> = [];
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
      send: async (_s, content) => {
        sent.push({ content });
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source,
      finalResponseRewriter: {
        rewrite: async () => ({ parts: [{ kind: "text", text: "   " }] }),
      },
    });
    const answer = "```ts\nconst x = 1;\n```";
    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-empty" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-empty" },
      data: { kind: "final_answer", content: answer, terminal: true },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-empty" }, data: {} } as never);
    await delivery.flush();

    expect(sent.map(({ content }) => content)).toEqual([answer]);
    await delivery.stop();
  });

  test("drops a late rewrite result after the renderer is disposed", async () => {
    const sent: string[] = [];
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
      send: async (_source, content) => {
        sent.push(content);
        return { kind: "sent", messageId: `m${sent.length}` };
      },
      handleWebhookUpdate: async () => false,
    };
    const delivery = new AgentChannelDelivery({ adapter });
    let resolveRewrite!: (value: { parts: [{ kind: "text"; text: string }] }) => void;
    let markRewriteStarted!: () => void;
    let rewriteSignal: AbortSignal | undefined;
    const rewriteStarted = new Promise<void>((resolve) => {
      markRewriteStarted = resolve;
    });
    const rewriteResult = new Promise<{ parts: [{ kind: "text"; text: string }] }>((resolve) => {
      resolveRewrite = resolve;
    });
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source: TestChannelSource,
      finalResponseRewriter: {
        rewrite: async (input) => {
          rewriteSignal = input.signal;
          markRewriteStarted();
          return rewriteResult;
        },
      },
    });

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-late" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-late" },
      data: { kind: "final_answer", content: "原始答案\n![图](senera://resource/r1)", terminal: true },
    } as never);
    const completion = renderer.handleEvent({
      kind: "run.completed",
      context: { requestId: "req-late" },
      data: {},
    } as never);
    await rewriteStarted;
    renderer.dispose();
    expect(rewriteSignal?.aborted).toBe(true);
    resolveRewrite({ parts: [{ kind: "text", text: "迟到答案" }] });
    await completion;
    await delivery.flush();

    expect(sent).toEqual([]);
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

    expect(sent).toEqual([{ content: "已取消本次处理。", options: undefined }]);
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

    expect(sent).toEqual([{ content: "已完成。", options: undefined }]);
    await delivery.stop();
  });

  test("projects final markdown images into native media delivery", async () => {
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

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-1" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-1" },
      data: { kind: "final_answer", content: `结果\n![截图](${dataUri})`, terminal: true },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-1" }, data: {} } as never);
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

  test("keeps unresolved Senera resources as Markdown text", async () => {
    const source = "说明文字\n![未找到的图片](senera://resource/missing-image)";
    const projection = await projectAgentChannelOutboundMedia(source, {
      resourceResolver: {
        resolve: async () => undefined,
      },
    });

    expect(projection.media).toEqual([]);
    expect(projection.caption).toBe(source);
  });

  test("projects authorized local workspace image paths from Markdown", async () => {
    const source = "前文\n![醍醐骑车](</E:/senera/tihao-bike.svg>)\n后文";
    const resolvedPaths: string[] = [];
    const projection = await projectAgentChannelOutboundMedia(source, {
      resourceResolver: {
        resolve: async () => undefined,
        resolveWorkspacePath: async (filePath) => {
          resolvedPaths.push(filePath);
          return {
            filePath: "E:/senera/tihao-bike.svg",
            name: "tihao-bike.svg",
            mime: "image/svg+xml",
            size: 128,
            sha256: "b".repeat(64),
          };
        },
      },
    });

    expect(resolvedPaths).toEqual(["E:/senera/tihao-bike.svg"]);
    expect(projection.media).toMatchObject([
      {
        kind: "image",
        path: "E:/senera/tihao-bike.svg",
        contentType: "image/svg+xml",
        filename: "tihao-bike.svg",
      },
    ]);
    expect(projection.segments).toEqual([
      { kind: "text", content: "前文" },
      { kind: "media", media: projection.media[0] },
      { kind: "text", content: "后文" },
    ]);
  });

  test("projects workspace-relative image paths without guessing an extension", async () => {
    const source = "前文\n![醍醐骑车](./tihao-bike.svg)\n后文";
    const resolvedPaths: string[] = [];
    const projection = await projectAgentChannelOutboundMedia(source, {
      resourceResolver: {
        resolve: async () => undefined,
        resolveWorkspacePath: async (filePath) => {
          resolvedPaths.push(filePath);
          return {
            filePath: "E:/senera/tihao-bike.svg",
            name: "tihao-bike.svg",
            mime: "image/svg+xml",
            size: 128,
            sha256: "c".repeat(64),
          };
        },
      },
    });

    expect(resolvedPaths).toEqual(["./tihao-bike.svg"]);
    expect(projection.media[0]).toMatchObject({
      kind: "image",
      path: "E:/senera/tihao-bike.svg",
      contentType: "image/svg+xml",
      filename: "tihao-bike.svg",
    });
    expect(projection.segments.map((segment) => segment.kind)).toEqual(["text", "media", "text"]);
  });

  test("keeps Windows drive paths out of URL protocol detection", async () => {
    const source = "![醍醐骑车](E:/senera/tihao-bike.svg)";
    const resolvedPaths: string[] = [];
    const projection = await projectAgentChannelOutboundMedia(source, {
      resourceResolver: {
        resolve: async () => undefined,
        resolveWorkspacePath: async (filePath) => {
          resolvedPaths.push(filePath);
          return {
            filePath: "E:/senera/tihao-bike.svg",
            name: "tihao-bike.svg",
            mime: "image/svg+xml",
            size: 128,
            sha256: "d".repeat(64),
          };
        },
      },
    });

    expect(resolvedPaths).toEqual(["E:/senera/tihao-bike.svg"]);
    expect(projection.media).toMatchObject([{ kind: "image", path: "E:/senera/tihao-bike.svg" }]);
    expect(projection.caption).toBe("");
  });

  test("preserves text and Markdown media order in the channel delivery stream", async () => {
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

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-order" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-order" },
      data: {
        kind: "final_answer",
        content: `前文\n![截图](${image})\n后文`,
        terminal: true,
      },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-order" }, data: {} } as never);
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

  test("removes repeated Markdown references after reusing the canonical media", async () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const projection = await projectAgentChannelOutboundMedia(
      `前文\n![第一次引用](${image})\n中间\n![再次引用](${image})\n后文`,
    );

    expect(projection.media).toHaveLength(1);
    expect(projection.caption).toBe("前文\n中间\n后文");
    expect(projection.segments.map((segment) => segment.kind)).toEqual(["text", "media", "text"]);
    expect(projection.segments[0]).toEqual({ kind: "text", content: "前文" });
    expect(projection.segments[2]).toEqual({ kind: "text", content: "中间\n后文" });
  });

  test("does not promote ordinary links or code samples to native media", async () => {
    const source = "[普通链接](https://example.com/image.png)\n`![代码](https://example.com/code.png)`";
    const projection = await projectAgentChannelOutboundMedia(source);

    expect(projection.media).toEqual([]);
    expect(projection.caption).toBe(source);
  });

  test("keeps fenced Markdown image examples as literal text", async () => {
    const source = "```md\n![示例](./tihao-bike.svg)\n```";
    const projection = await projectAgentChannelOutboundMedia(source, {
      resourceResolver: {
        resolve: async () => undefined,
        resolveWorkspacePath: async () => {
          throw new Error("fenced image must not be resolved");
        },
      },
    });

    expect(projection.media).toEqual([]);
    expect(projection.caption).toBe(source);
  });

  test("projects MCP audio, video, and file blocks from their MIME types", async () => {
    const projection = await projectAgentChannelMediaFromValue({
      content: [
        { type: "audio", mimeType: "audio/wav", data: "UklGRg==" },
        { type: "video", mimeType: "video/mp4", data: "AAAA" },
        { type: "file", mimeType: "application/pdf", data: "JVBERg==" },
      ],
    });

    expect(projection.media.map((item) => item.kind)).toEqual(["audio", "video", "file"]);
    expect(projection.media.map((item) => item.contentType)).toEqual(["audio/wav", "video/mp4", "application/pdf"]);
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

    await renderer.handleEvent({ kind: "run.started", context: { requestId: "req-1" }, data: {} } as never);
    await renderer.handleEvent({
      kind: "tool.call.result.detail",
      context: { requestId: "req-1" },
      data: {
        value: {
          content: [{ type: "image", mimeType: "image/png", uri: "senera://resource/artifact-image" }],
        },
      },
    } as never);
    await renderer.handleEvent({
      kind: "assistant.message.created",
      context: { requestId: "req-1" },
      data: {
        kind: "final_answer",
        content: "![同一张图](senera://resource/artifact-image)",
        terminal: true,
      },
    } as never);
    await renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-1" }, data: {} } as never);
    await delivery.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.options?.media?.[0]).toMatchObject({ kind: "image", contentType: "image/png" });
    expect(sent[0]?.options?.media?.[0]).toMatchObject({ path: "E:/senera/.tmp/test-image.png" });
    await delivery.stop();
  });

  test("serializes concurrent terminal events and deduplicates inline/resource representations by content hash", async () => {
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
    const inline = "data:image/png;base64,iVBORw0KGgo=";
    const inlineProjection = await projectAgentChannelOutboundMedia(`![图](${inline})`);
    const hash = inlineProjection.media[0]?.contentHash;
    expect(hash).toBeTruthy();
    const renderer = new AgentChannelRunRenderer({
      adapter,
      delivery,
      source: TestChannelSource,
      resourceResolver: {
        resolve: async (resourceUri: string) => ({
          resourceUri,
          filePath: "E:/senera/.tmp/hash-image.png",
          name: "hash-image.png",
          mime: "image/png",
          size: 4,
          sha256: hash!,
          origin: "artifact" as const,
        }),
      },
    });

    const toolEvent = {
      kind: "tool.call.result.detail",
      context: { requestId: "req-1" },
      data: { value: { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] } },
    } as never;
    const finalEvent = {
      kind: "assistant.message.created",
      context: { requestId: "req-1" },
      data: { kind: "final_answer", content: `结果\n![图](senera://resource/hash-image)`, terminal: true },
    } as never;
    await Promise.all([
      renderer.handleEvent({ kind: "run.started", context: { requestId: "req-1" }, data: {} } as never),
      renderer.handleEvent(toolEvent),
      renderer.handleEvent(finalEvent),
      renderer.handleEvent({ kind: "run.completed", context: { requestId: "req-1" }, data: {} } as never),
    ]);
    await delivery.flush();

    expect(sent.filter((entry) => entry.options?.media?.length).length).toBe(1);
    expect(sent.filter((entry) => entry.content.trim() === "结果").length).toBe(1);
    expect(agentChannelMediaIdentity(inlineProjection.media[0]!)).toBe(
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
