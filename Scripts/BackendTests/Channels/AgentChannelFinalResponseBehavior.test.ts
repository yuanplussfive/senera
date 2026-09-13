import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AgentChannelFinalResponseBamlRewriter,
  parseAgentChannelFinalDelivery,
  projectAgentChannelFinalParts,
} from "../../../Source/AgentSystem/Channels/AgentChannelFinalResponse.js";
import type { AgentBamlModelRequest } from "../../../Source/AgentSystem/BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentActionPlannerModelTransport } from "../../../Source/AgentSystem/ActionPlanner/AgentActionPlannerModelTransport.js";
import {
  collectAgentChannelMarkdownResourceManifest,
  projectAgentChannelFinalParts as projectOutboundFinalParts,
} from "../../../Source/AgentSystem/Channels/AgentChannelOutboundMedia.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

describe("channel final response rewriter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("projects the BAML rewrite through the conversation cache boundary", async () => {
    const requestCapture: {
      request?: unknown;
      signal?: AbortSignal;
      timingSink?: unknown;
    } = {};
    const complete = vi
      .spyOn(AgentActionPlannerModelTransport.prototype, "complete")
      .mockImplementation(async (request, signal, timingSink) => {
        requestCapture.request = request;
        requestCapture.signal = signal;
        requestCapture.timingSink = timingSink;
        return JSON.stringify({ parts: [{ kind: "text", text: "已发送" }] });
      });
    const timingSink = vi.fn();
    const rewriter = new AgentChannelFinalResponseBamlRewriter(
      createModelProvider({ ToolPlanningMode: "baml", MaxOutputTokens: 256 }),
    );

    await expect(
      rewriter.rewrite({
        content: "第一段\n![图](senera://resource/r1)\n第二段",
        source: {
          platform: "qq",
          chatType: "direct",
          chatId: "chat-1",
          userId: "user-1",
        },
        sessionId: "session-1",
        requestId: "request-1",
        logicalCacheScope: "channel-scope-1",
        timingSink,
        context: {
          resourceManifest: {
            references: [
              {
                source: "senera://resource/r1",
                kind: "senera",
                resourceUri: "senera://resource/r1",
                name: "image.svg",
                mime: "image/svg+xml",
              },
            ],
          },
          history: [
            {
              id: "history-1",
              createdAt: "2026-01-01T00:00:00.000Z",
              platform: "qq",
              chatType: "direct",
              content: "上一条",
              parts: [{ kind: "text", text: "上一条" }],
            },
          ],
        },
      }),
    ).resolves.toEqual({ parts: [{ kind: "text", text: "已发送" }] });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(requestCapture.signal).toBeUndefined();
    expect(requestCapture.timingSink).toBe(timingSink);
    expect(requestCapture.request).toMatchObject({
      requestId: "request-1",
      cache: {
        sessionId: "session-1",
        logicalCacheScope: "channel-scope-1",
        retention: "long",
        stablePrefixRevision: expect.any(String),
        stablePrefixBytes: expect.any(Number),
      },
      systemPrompt: expect.stringContaining("Current channel platform: qq."),
      messages: [
        {
          role: "user",
          content: expect.stringContaining('"resourceUri":"senera://resource/r1"'),
        },
      ],
    });
    expect((requestCapture.request as { messages: [{ content: string }] }).messages[0].content).toContain(
      '"id":"history-1"',
    );
  });

  test("repairs one malformed BAML projection while retaining its cache boundary", async () => {
    const requests: AgentBamlModelRequest[] = [];
    const complete = vi
      .spyOn(AgentActionPlannerModelTransport.prototype, "complete")
      .mockImplementation(async (request) => {
        requests.push(request);
        return requests.length === 1 ? "not-json" : JSON.stringify({ parts: [{ kind: "text", text: "修复后" }] });
      });
    const rewriter = new AgentChannelFinalResponseBamlRewriter(createModelProvider({ ToolPlanningMode: "baml" }));

    await expect(
      rewriter.rewrite({
        content: "回答",
        source: {
          platform: "qq",
          chatType: "direct",
          chatId: "chat-1",
          userId: "user-1",
        },
        sessionId: "session-1",
        logicalCacheScope: "channel-scope-1",
      }),
    ).resolves.toEqual({ parts: [{ kind: "text", text: "修复后" }] });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(requests[1]?.step).toBe(1);
    expect(requests[1]?.cache).toEqual(requests[0]?.cache);
    expect(requests[1]?.messages.at(-1)?.content).toContain("<channel_final_delivery_repair>");
    expect(requests[1]?.messages.at(-1)?.content).toContain("not-json");
  });

  test("projects native tool-call arguments into a structured final delivery", () => {
    const parts = projectAgentChannelFinalParts({
      parts: [
        { kind: "text", text: "前文" },
        { kind: "resource", uri: "senera://resource/r1", alt: "图" },
        { kind: "code", language: "svg", code: "<svg />" },
        { kind: "text", text: "" },
      ],
    });
    expect(parts).toEqual([
      { kind: "text", text: "前文" },
      { kind: "resource", uri: "senera://resource/r1", alt: "图" },
      { kind: "code", language: "svg", code: "<svg />" },
    ]);
  });

  test("parses a fenced JSON BAML response", () => {
    const parts = parseAgentChannelFinalDelivery(
      '```json\n{"parts":[{"kind":"text","text":"hi"},{"kind":"code","language":"ts","code":"const x = 1;"}]}\n```',
    );
    expect(parts).toEqual([
      { kind: "text", text: "hi" },
      { kind: "code", language: "ts", code: "const x = 1;" },
    ]);
  });

  test("builds a bounded manifest with canonical, HTTP, and workspace mappings", async () => {
    const manifest = await collectAgentChannelMarkdownResourceManifest(
      [
        "前文",
        "![远程](https://cdn.example/image.png)",
        "![本地](YaeMiko.svg)",
        "![资源](senera://resource/artifact-image)",
        "[普通链接](https://cdn.example/other.png)",
      ].join("\n"),
      {
        resourceResolver: {
          resolve: async (resourceUri) =>
            resourceUri === "senera://resource/artifact-image"
              ? {
                  resourceUri,
                  filePath: "E:/senera/.tmp/YaeMiko.svg",
                  name: "YaeMiko.svg",
                  mime: "image/svg+xml",
                  size: 128,
                  sha256: "a".repeat(64),
                  origin: "artifact" as const,
                }
              : undefined,
          resolveWorkspacePath: async (_filePath) => ({
            filePath: "C:/Users/1/Downloads/YaeMiko.svg",
            name: "YaeMiko.svg",
            mime: "image/svg+xml",
            size: 128,
            sha256: "b".repeat(64),
          }),
        },
      },
    );

    expect(manifest.references).toEqual([
      { source: "https://cdn.example/image.png", kind: "http", url: "https://cdn.example/image.png" },
      {
        source: "YaeMiko.svg",
        kind: "workspace",
        absolutePath: "C:/Users/1/Downloads/YaeMiko.svg",
        name: "YaeMiko.svg",
        mime: "image/svg+xml",
      },
      {
        source: "senera://resource/artifact-image",
        kind: "senera",
        resourceUri: "senera://resource/artifact-image",
        name: "YaeMiko.svg",
        mime: "image/svg+xml",
      },
    ]);
  });

  test("does not guess unresolved paths or inspect ordinary Markdown links", async () => {
    const manifest = await collectAgentChannelMarkdownResourceManifest(
      "![缺失](missing.svg)\n[下载](https://cdn.example/file.svg)\n```md\n![示例](inside.svg)\n```",
      {
        resourceResolver: {
          resolve: async () => undefined,
          resolveWorkspacePath: async () => undefined,
        },
      },
    );

    expect(manifest.references).toEqual([{ source: "missing.svg", kind: "unresolved" }]);
  });

  test("normalizes a Markdown image left inside a text part", async () => {
    const projection = await projectOutboundFinalParts([
      { kind: "text", text: "前文\n![截图](https://cdn.example/screenshot.png)\n后文" },
    ]);

    expect(projection.segments.map((segment) => segment.kind)).toEqual(["text", "media", "text"]);
    expect(projection.segments[1]).toMatchObject({
      kind: "media",
      media: { kind: "image", url: "https://cdn.example/screenshot.png" },
    });
    expect(projection.segments[0]).toEqual({ kind: "text", content: "前文" });
    expect(projection.segments[2]).toEqual({ kind: "text", content: "后文" });
  });
});
