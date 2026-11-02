import { afterEach, expect, test, vi } from "vitest";
import { downloadBlob, downloadUrl, openExternalLink } from "@senera/resource-links";

afterEach(() => {
  delete window.__SENERA_MOBILE__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("console and QQ delegate authenticated HTTP downloads, generated files, and links to the same mobile host", async () => {
  const host = {
    download: vi.fn(async () => {}),
    saveFile: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
  };
  window.__SENERA_MOBILE__ = host;
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(downloadUrl("/api/resources/a1b2c3?workspaceId=a", "照片.jpg")).resolves.toBe("delegated");
  expect(host.download).toHaveBeenCalledWith(
    new URL("/api/resources/a1b2c3?workspaceId=a", location.href).href,
    "照片.jpg",
  );
  const blob = new Blob(["generated"], { type: "text/plain" });
  await downloadBlob(blob, "file.txt");
  expect(host.saveFile).toHaveBeenCalledWith(blob, "file.txt");
  await openExternalLink("https://example.com/docs");
  expect(host.openExternal).toHaveBeenCalledWith("https://example.com/docs");
  expect(fetch).not.toHaveBeenCalled();
});

test("native failures surface to callers, and unsupported addresses never enter the host", async () => {
  const download = vi.fn(async () => {
    throw new Error("permission denied");
  });
  window.__SENERA_MOBILE__ = { download };
  await expect(downloadUrl("/api/resources/a1b2c3", "file")).rejects.toThrow("permission denied");
  await expect(downloadUrl("javascript:alert(1)", "file")).rejects.toThrow("Unsupported");
  await expect(openExternalLink("file:///private")).rejects.toThrow("Unsupported");
  await expect(openExternalLink("https://user:password@example.com")).rejects.toThrow("Unsupported");
  expect(download).toHaveBeenCalledTimes(1);
});

test("browser downloads report stream progress and cancel the reader when consumers fail", async () => {
  const value = new Uint8Array([1, 2, 3]);
  const reader = {
    read: vi.fn().mockResolvedValueOnce({ done: false, value }),
    cancel: vi.fn(async () => {}),
    releaseLock: vi.fn(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      body: { getReader: () => reader },
      headers: new Headers({ "Content-Length": "3" }),
    })),
  );
  const progress = vi.fn(() => {
    throw new Error("cancelled");
  });
  await expect(downloadUrl("/api/resources/a1b2c3", "file", { onProgress: progress })).rejects.toThrow("cancelled");
  expect(progress).toHaveBeenCalledWith({ loaded: 3, total: 3 });
  expect(reader.cancel).toHaveBeenCalledTimes(1);
  expect(reader.releaseLock).toHaveBeenCalledTimes(1);
});
