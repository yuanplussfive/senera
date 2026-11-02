import { afterEach, describe, expect, test } from "vitest";
import { resolveMessageUrls } from "../../../Frontend/qq/client/src/renderer/src/runtime/messageUrls.ts";

const host = "https://senera.test/api/channel-clients/onebot11/workspace/";
const mediaPath = "/api/channel-clients/onebot11/workspace/media/image.png";

afterEach(() => document.querySelector("base")?.remove());

describe("hosted QQ media transport", () => {
  test("replays uploaded resource references through the same workspace resource route", () => {
    const segments = [
      { type: "file", file: "senera://resource/a1b2c3", url: "senera://resource/a1b2c3" },
      { type: "image", file: "senera://resource/d4e5f6" },
    ];
    resolveMessageUrls(segments, host, "https://senera.test/?workspaceId=workspace");
    expect(segments.map((part) => part.url)).toEqual([
      "https://senera.test/api/resources/a1b2c3?workspaceId=workspace",
      "https://senera.test/api/resources/d4e5f6?workspaceId=workspace",
    ]);
    expect(segments[0].file).toBe("senera://resource/a1b2c3");
  });
  test("history media and links work in WebViews without the newer URL.canParse API", async () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse");
    Object.defineProperty(URL, "canParse", { configurable: true, writable: true, value: undefined });
    try {
      await import("../../../Frontend/src/platform/browserCompatibility.ts");
      const segments = [
        { type: "image", url: mediaPath },
        { type: "file", url: "media/report.pdf" },
      ];
      resolveMessageUrls(segments, host);
      expect(segments.map((segment) => segment.url)).toEqual([
        `https://senera.test${mediaPath}`,
        `${host}media/report.pdf`,
      ]);
      expect(URL.canParse("https://example.test/picture.jpg")).toBe(true);
      expect(URL.canParse("https://[invalid")).toBe(false);
      expect(URL.canParse("./file.pdf", host)).toBe(true);
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original);
      else delete URL.canParse;
    }
  });

  test("loads media from the host when development assets use another origin", () => {
    const base = document.createElement("base");
    base.href = "https://vite.test/qq/index.html";
    document.head.prepend(base);
    const segments = ["image", "mface", "video", "record", "file"].map((type) => ({
      type,
      file: "opaque-protocol-file-id",
      url: mediaPath,
    }));

    resolveMessageUrls(segments, host, "https://senera.test/?workspaceId=workspace");

    for (const segment of segments) {
      const element = document.createElement(segment.type === "file" ? "a" : "img");
      const attribute = segment.type === "file" ? "href" : "src";
      element.setAttribute(attribute, segment.url);
      expect(element[attribute]).toBe(`https://senera.test${mediaPath}`);
      expect(segment.file).toBe("opaque-protocol-file-id");
    }
  });

  test("retains external, signed, inline and blob URLs without treating text or IDs as URLs", () => {
    const segments = [
      { type: "image", url: "https://cdn.test/picture.png?sig=a%2Fb&Expires=123" },
      { type: "image", url: "data:image/png;base64,aGVsbG8=" },
      { type: "image", url: "blob:https://senera.test/uuid" },
      { type: "text", text: "./notes.md /api/example" },
      { type: "reply", id: "60" },
      { type: "file", file: "./opaque-name" },
    ];
    const original = structuredClone(segments);
    resolveMessageUrls(segments, host);
    expect(segments).toEqual(original);
  });

  test("resolves protocol relative and host relative URLs once for replay and quoted messages", () => {
    const segments = [{ url: "media/image.png" }, { url: "//cdn.test/image.png" }];
    resolveMessageUrls(segments, host);
    expect(segments.map((segment) => segment.url)).toEqual([`${host}media/image.png`, "https://cdn.test/image.png"]);
    const resolved = structuredClone(segments);
    resolveMessageUrls(segments, host);
    expect(segments).toEqual(resolved);
  });
});
