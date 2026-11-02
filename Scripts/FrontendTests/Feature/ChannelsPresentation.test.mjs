// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import { renderChannelMarkdown } from "../../../Frontend/qq/client/src/renderer/src/runtime/channelMarkdown.ts";
import { seneraConsoleUrl } from "../../../Frontend/qq/client/src/renderer/src/runtime/seneraContext.ts";
import { openOneBot11Client } from "../../../Frontend/src/app/channelClientNavigation.ts";
import { buildResourceContentUrl, buildWorkspaceResourceUrl } from "@senera/resource-links";

const base = "https://host.test/?workspaceId=workspace-a";

afterEach(() => {
  document.head.querySelectorAll("meta[data-navigation-test]").forEach((node) => node.remove());
  delete window.seneraDesktop;
  delete window.__SENERA_MOBILE__;
  vi.restoreAllMocks();
});

test("the first render has complete emoji metadata without timers or application startup", async () => {
  vi.useFakeTimers();
  try {
    const { default: Emoji } = await import("../../../Frontend/qq/client/src/renderer/src/function/model/emoji.ts");
    for (const id of [...Emoji.superList, ...Emoji.normalList, ...Emoji.responseApngId]) {
      expect(Emoji.get(id)?.type).toBe("apng");
      expect(Emoji.get(id)?.description).not.toContain("./img/");
    }
    for (const id of Emoji.superList) {
      expect(Emoji.get(id)?.hasSuper).toBe(true);
      expect(Emoji.get(id)?.superValue).toMatch(/\.json$/u);
    }
    expect(Emoji.get(128522)?.value).toBe("😊");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

function declare(name, content) {
  const meta = document.createElement("meta");
  meta.name = name;
  meta.content = content;
  meta.dataset.navigationTest = "";
  document.head.append(meta);
}

test.each(["/", "/development/"])("returns to the console route declared by the host: %s", (path) => {
  declare("senera-console-path", path);
  declare("senera-workspace-id", "workspace-a");
  const url = new URL(seneraConsoleUrl("channels"));
  expect(url.origin).toBe(window.location.origin);
  expect(url.pathname).toBe(path);
  expect(url.searchParams.get("workspaceId")).toBe("workspace-a");
  expect(url.searchParams.get("settings")).toBe("channels");
});

test("rejects missing or foreign console navigation instead of guessing an address", () => {
  expect(() => seneraConsoleUrl()).toThrow("导航上下文");
  declare("senera-console-path", "https://other.test/");
  expect(() => seneraConsoleUrl()).toThrow("同一服务");
});

test("opens the workspace client separately without replacing the console or its settings", async () => {
  window.history.replaceState(null, "", "/?workspaceId=workspace-a&settings=channels");
  const location = window.location.href;
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const source = "http://localhost/api/channel-clients/onebot11/workspace-a/";
  expect(await openOneBot11Client(source, "workspace-a")).toEqual({ ok: true });
  expect(open).toHaveBeenCalledWith(source, "_blank", "noopener,noreferrer");
  expect(window.location.href).toBe(location);
});

test("desktop delegates the workspace identity to its isolated client window", async () => {
  const open = vi.spyOn(window, "open");
  const openClient = vi.fn(async () => ({ ok: true }));
  window.seneraDesktop = { isDesktop: true, openQqClient: openClient };
  expect(await openOneBot11Client("http://localhost/qq/", "workspace-b")).toEqual({ ok: true });
  expect(openClient).toHaveBeenCalledExactlyOnceWith("workspace-b");
  expect(open).not.toHaveBeenCalled();
});

test("does not substitute browser navigation when the desktop client cannot open", async () => {
  const open = vi.spyOn(window, "open");
  window.seneraDesktop = { isDesktop: true };
  expect(await openOneBot11Client("http://localhost/qq/", "workspace-b")).toEqual({ ok: false });
  expect(open).not.toHaveBeenCalled();
});

test("a mobile host with connection navigation uses its isolated popup handler for QQ", async () => {
  window.__SENERA_MOBILE__ = { openConnections: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const source = "http://paired.test/api/channel-clients/onebot11/workspace-a/";
  expect(await openOneBot11Client(source, "workspace-a")).toEqual({ ok: true });
  expect(open).toHaveBeenCalledWith(source, "_blank", "noopener,noreferrer");
});

function render(source) {
  const root = document.createElement("div");
  root.innerHTML = renderChannelMarkdown(source, base);
  return root;
}

describe("QQ and console resource links", () => {
  test.each(["./reports/测试.md", "E:/workspace/report.md:12:3", "file:///E:/workspace/report.md#L12"])(
    "shares the console URL pipeline for %s",
    (source) => {
      const root = render(`[report](${source})`);
      const link = root.querySelector("a");
      expect(link).not.toBeNull();
      const path = source.startsWith("./") ? source : "E:/workspace/report.md";
      expect(link.href).toBe(buildWorkspaceResourceUrl(base, path, true));
      expect(link.dataset.resourceLink).toBe("true");
    },
  );

  test("keeps resource URIs clickable and resolves local Markdown images in the current workspace", () => {
    const root = render("[report.pdf](senera://resource/res_test)\n\n![preview](./images/预览.png)");
    expect(root.querySelector("a").href).toBe(buildResourceContentUrl(base, "senera://resource/res_test"));
    expect(root.querySelector("img").src).toBe(buildWorkspaceResourceUrl(base, "./images/预览.png", true));
    expect(root.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  test("keeps external link labels and isolates them from surrounding text", () => {
    const root = render("before [issue](https://github.com/example/repo/issues/1) after");
    const link = root.querySelector("a");
    expect(link.textContent).toBe("issue");
    expect(link.href).toBe("https://github.com/example/repo/issues/1");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.hasAttribute("data-resource-link")).toBe(false);
    expect(root.querySelector("p").lastChild.textContent).toBe(" after");
  });

  test("preserves code-copy and GFM tables while rejecting executable links and raw HTML", () => {
    const root = render(
      "[bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n```ts\nconst answer = 42\n```\n\n| key | value |\n| --- | --- |\n| a | b |",
    );
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".channel-code-copy").textContent).toBe("复制");
    expect(root.querySelector("pre code").textContent).toContain("const answer = 42");
    expect(root.querySelector("td").textContent).toBe("a");
  });
});
