import { describe, expect, test } from "vitest";
import {
  isChannelFinalRewriteCandidate,
  parseAgentChannelFinalDelivery,
  projectAgentChannelFinalParts,
} from "../../../Source/AgentSystem/Channels/AgentChannelFinalResponse.js";
import { collectAgentChannelMarkdownResourceManifest } from "../../../Source/AgentSystem/Channels/AgentChannelOutboundMedia.js";

describe("channel final response rewriter", () => {
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

  test("detects resource references for rewrite candidates", () => {
    expect(isChannelFinalRewriteCandidate("看图 ![截图](data:image/png;base64,AA==)")).toBe(true);
    expect(isChannelFinalRewriteCandidate("见 senera://resource/r1")).toBe(true);
    expect(isChannelFinalRewriteCandidate("[下载](https://example.com/a/b.zip)")).toBe(true);
    expect(isChannelFinalRewriteCandidate("普通聊天回答，没有任何引用。")).toBe(false);
    expect(isChannelFinalRewriteCandidate("")).toBe(false);
  });

  test("qualifies long plain-text answers by token estimate", () => {
    const shortAscii = "a".repeat(600); // ~150 tokens, at or below the default threshold
    expect(isChannelFinalRewriteCandidate(shortAscii)).toBe(false);
    const longAscii = "a".repeat(900); // ~225 tokens, above the default threshold
    expect(isChannelFinalRewriteCandidate(longAscii)).toBe(true);
    const shortCjk = "汉".repeat(150); // ~150 tokens
    expect(isChannelFinalRewriteCandidate(shortCjk)).toBe(false);
    const longCjk = "汉".repeat(250); // ~250 tokens
    expect(isChannelFinalRewriteCandidate(longCjk)).toBe(true);
  });

  test("honors a custom token threshold", () => {
    const content = "a".repeat(800); // ~200 tokens
    expect(isChannelFinalRewriteCandidate(content, { minTokens: 200 })).toBe(false);
    expect(isChannelFinalRewriteCandidate(content, { minTokens: 100 })).toBe(true);
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
});
