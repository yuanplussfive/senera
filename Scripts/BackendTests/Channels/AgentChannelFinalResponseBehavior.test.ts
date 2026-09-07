import { describe, expect, test } from "vitest";
import {
  parseAgentChannelFinalDelivery,
  projectAgentChannelFinalParts,
} from "../../../Source/AgentSystem/Channels/AgentChannelFinalResponse.js";
import {
  collectAgentChannelMarkdownResourceManifest,
  projectAgentChannelFinalParts as projectOutboundFinalParts,
} from "../../../Source/AgentSystem/Channels/AgentChannelOutboundMedia.js";

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
