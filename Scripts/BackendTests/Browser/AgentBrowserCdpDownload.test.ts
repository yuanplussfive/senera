import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, test, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  downloadAgentBrowserFile,
  type AgentBrowserCdpDownloadRequest,
} from "../../../Source/AgentSystem/Browser/AgentBrowserCdpDownload.js";

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
}

describe("browser download lifecycle", () => {
  test("correlates popup frames before accepting buffered transfer progress", async () => {
    await fixture(async (f) => {
      const result = await f.download({
        activate: async () => {
          f.event("Target.attachedToTarget", {
            sessionId: "popup-session",
            targetInfo: { targetId: "popup", openerId: "tab" },
            waitingForDebugger: true,
          });
          f.event("Browser.downloadWillBegin", {
            frameId: "popup-main",
            guid: "popup-file",
            suggestedFilename: "image.png",
          });
          f.progress("popup-file", "completed");
        },
      });
      expect(result).toMatchObject({ filePath: path.join(f.directory, "popup-file"), suggestedFilename: "image.png" });
      expect(f.messages).toContainEqual(
        expect.objectContaining({ method: "Fetch.enable", sessionId: "popup-session" }),
      );
    });
  });
  test("uses the download GUID on disk even when CDP omits filePath, and ignores other tabs and unannounced progress", async () => {
    await fixture(async (f) => {
      const result = await f.download({
        activate: async () => {
          f.event("Browser.downloadWillBegin", { frameId: "foreign", guid: "foreign" });
          f.event("Browser.downloadProgress", { guid: "foreign", state: "completed" });
          f.event("Browser.downloadProgress", { guid: "unannounced", state: "completed" });
          await fs.writeFile(path.join(f.directory, "owned"), "content");
          f.begin("owned");
          f.progress("owned", "completed");
        },
      });
      expect(result).toEqual({
        filePath: path.join(f.directory, "owned"),
        suggestedFilename: "report.csv",
        url: "https://example.test/report",
      });
      expect(f.messages).toContainEqual(
        expect.objectContaining({
          method: "Browser.setDownloadBehavior",
          params: { behavior: "allowAndName", downloadPath: f.directory, eventsEnabled: true },
        }),
      );
      expect(f.messages).toContainEqual(
        expect.objectContaining({
          method: "Browser.setDownloadBehavior",
          params: { behavior: "default", eventsEnabled: false },
        }),
      );
    });
  });

  test("a completed download does not wait for a CLI click stuck waiting for navigation", async () => {
    await fixture(async (f) => {
      let signal: AbortSignal | undefined;
      await f.download({
        activate: async (value) => {
          signal = value;
          f.begin("owned");
          f.progress("owned", "completed");
          await new Promise(() => undefined);
        },
      });
      expect(signal?.aborted).toBe(true);
    });
  });

  test("cancels the owned transfer when its byte budget is exceeded", async () => {
    await fixture(async (f) => {
      await expect(
        f.download(
          {
            activate: async () => {
              f.begin("owned");
              f.progress("owned", "inProgress", { receivedBytes: 101 });
            },
          },
          { maxBytes: 100 },
        ),
      ).rejects.toThrow(/100 byte limit/u);
      expect(f.messages).toContainEqual(
        expect.objectContaining({ method: "Browser.cancelDownload", params: { guid: "owned" } }),
      );
    });
  });

  test("interrupts activation and cancels the owned transfer on abort", async () => {
    await fixture(async (f) => {
      const controller = new AbortController();
      await expect(
        f.download(
          {
            activate: async () => {
              f.begin("owned");
              await vi.waitFor(() => expect(f.messages.length).toBeGreaterThan(0));
              setTimeout(() => controller.abort(new Error("user canceled")), 20);
              await new Promise(() => undefined);
            },
          },
          { signal: controller.signal },
        ),
      ).rejects.toThrow(/user canceled/u);
      expect(f.messages).toContainEqual(
        expect.objectContaining({ method: "Browser.cancelDownload", params: { guid: "owned" } }),
      );
    });
  });

  test("waits through navigation until the new document actually loads", async () => {
    await fixture(async (f) => {
      const request = f.download({
        activate: async () => {
          f.event("Page.frameNavigated", { frame: { id: "main" } }, "page-session");
          f.event("Page.loadEventFired", {}, "foreign-session");
          f.begin("owned");
          f.progress("owned", "completed");
        },
      });
      await expect(request).resolves.toHaveProperty("suggestedFilename", "report.csv");
    });
  });

  test("reports a completed document navigation with instructions to use the URL mode", async () => {
    await fixture(async (f) => {
      await expect(
        f.download({
          activate: async () => {
            f.event("Page.frameNavigated", { frame: { id: "main" } }, "page-session");
            f.event("Page.loadEventFired", {}, "page-session");
          },
        }),
      ).rejects.toThrow(/with url instead of selector/u);
    });
  });

  test("the timeout bounds activation and CDP setup without an unresolved promise", async () => {
    await fixture(async (f) => {
      await expect(
        f.download({ activate: async () => new Promise(() => undefined) }, { timeoutMs: 50 }),
      ).rejects.toThrow(/within 50ms/u);
    });
  });

  test("checks every URL redirect before continuing the browser request", async () => {
    await fixture(async (f) => {
      const permission = vi.fn(async (url: string) => {
        if (url === "http://private.test/") throw new Error("blocked redirect");
      });
      f.onNavigate = () => {
        f.event(
          "Fetch.requestPaused",
          {
            requestId: "redirect",
            request: { url: "http://private.test/" },
            frameId: "main",
            resourceType: "Document",
          },
          "page-session",
        );
      };
      await expect(
        f.download({ url: "https://example.test/file" }, { assertRequestPermitted: permission }),
      ).rejects.toThrow(/blocked redirect/u);
      expect(permission).toHaveBeenCalledWith("http://private.test/");
      expect(f.messages).toContainEqual(
        expect.objectContaining({
          method: "Fetch.failRequest",
          params: { requestId: "redirect", errorReason: "BlockedByClient" },
        }),
      );
    });
  });
});

async function fixture(
  run: (fixture: {
    directory: string;
    messages: CdpMessage[];
    event: (method: string, params: Record<string, unknown>, sessionId?: string) => void;
    begin: (guid: string) => void;
    progress: (guid: string, state: string, extras?: Record<string, unknown>) => void;
    onNavigate?: () => void;
    download: (
      source: AgentBrowserCdpDownloadRequest["source"],
      overrides?: Partial<AgentBrowserCdpDownloadRequest>,
    ) => ReturnType<typeof downloadAgentBrowserFile>;
  }) => Promise<void>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "senera-cdp-download-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const sockets = new Set<WebSocket>();
  const messages: CdpMessage[] = [];
  const event = (method: string, params: Record<string, unknown>, sessionId?: string) => {
    for (const socket of sockets)
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method, params, sessionId }));
  };
  await once(server, "listening");
  const f = {
    directory,
    messages,
    event,
    begin: (guid: string) =>
      event("Browser.downloadWillBegin", {
        frameId: "main",
        guid,
        suggestedFilename: "report.csv",
        url: "https://example.test/report",
      }),
    progress: (guid: string, state: string, extras = {}) =>
      event("Browser.downloadProgress", { guid, state, ...extras }),
    onNavigate: undefined as (() => void) | undefined,
    download: (
      source: AgentBrowserCdpDownloadRequest["source"],
      overrides: Partial<AgentBrowserCdpDownloadRequest> = {},
    ) =>
      downloadAgentBrowserFile({
        cdpUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/devtools/browser/test`,
        targetId: "tab",
        directory,
        timeoutMs: 2000,
        maxBytes: 1000,
        assertRequestPermitted: async () => undefined,
        source,
        ...overrides,
      }),
  };
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as CdpMessage;
      messages.push(message);
      const result =
        message.method === "Target.attachToTarget"
          ? { sessionId: "page-session" }
          : message.method === "Page.getFrameTree"
            ? {
                frameTree: {
                  frame: { id: message.sessionId === "popup-session" ? "popup-main" : "main" },
                  childFrames: [{ frame: { id: "child" } }],
                },
              }
            : {};
      if (message.method === "Page.navigate") f.onNavigate?.();
      socket.send(JSON.stringify({ id: message.id, result }));
    });
  });
  try {
    await run(f);
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
