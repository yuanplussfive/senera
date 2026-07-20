import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openDesktopSettings, openExternalUrl, readDesktopBridge } from "../../../Frontend/src/app/desktopBridge.ts";
import { isTrustedDesktopNavigation, resolveExternalHttpUrl } from "../../../Apps/Desktop/DesktopNavigationPolicy.ts";
import { DesktopClosePolicy } from "../../../Apps/Desktop/DesktopClosePolicy.ts";

describe("openExternalUrl", () => {
  it("uses the desktop bridge for a validated HTTPS URL", async () => {
    const openDesktopUrl = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn();

    await expect(
      openExternalUrl("https://accounts.example.com/login", {
        bridge: { isDesktop: true, openExternalUrl: openDesktopUrl },
        openWindow,
      }),
    ).resolves.toBe("desktop");

    expect(openDesktopUrl).toHaveBeenCalledWith("https://accounts.example.com/login");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens validated web URLs with opener isolation", async () => {
    const opened = {};
    const openWindow = vi.fn(() => opened);

    await expect(openExternalUrl("http://127.0.0.1:8787/callback", { bridge: undefined, openWindow })).resolves.toBe(
      "web",
    );
    expect(openWindow).toHaveBeenCalledWith("http://127.0.0.1:8787/callback");
  });

  it("blocks insecure remote HTTP and credential-bearing URLs", async () => {
    const openWindow = vi.fn();

    await expect(openExternalUrl("http://accounts.example.com/login", { bridge: undefined, openWindow })).resolves.toBe(
      "blocked",
    );
    await expect(
      openExternalUrl("https://user:secret@accounts.example.com/login", { bridge: undefined, openWindow }),
    ).resolves.toBe("blocked");
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe("desktop settings bridge", () => {
  it("opens the first settings section when no target is specified", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    await expect(openDesktopSettings({ bridge: { isDesktop: true, openSettings } })).resolves.toBe(true);
    expect(openSettings).toHaveBeenCalledWith({ section: "model-service" });
  });

  it("opens an explicitly requested desktop settings section", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    await expect(
      openDesktopSettings({ bridge: { isDesktop: true, openSettings }, section: "appearance" }),
    ).resolves.toBe(true);
    expect(openSettings).toHaveBeenCalledWith({ section: "appearance" });
  });

  it("does not claim a web surface", async () => {
    await expect(openDesktopSettings({ bridge: undefined, section: "runtime" })).resolves.toBe(false);
  });

  it("reads the exposed desktop bridge", () => {
    const previous = window.seneraDesktop;
    const bridge = { isDesktop: true, openSettings: vi.fn().mockResolvedValue(undefined) };
    window.seneraDesktop = bridge;
    expect(readDesktopBridge()).toBe(bridge);
    window.seneraDesktop = previous;
  });
});

describe("desktop main-process policies", () => {
  it("requires confirmation for dirty main-window and app close requests", () => {
    const policy = new DesktopClosePolicy();
    expect(policy.request("main")).toBe(false);

    policy.setDirty(true);
    expect(policy.request("main")).toBe(true);
    policy.cancel();
    expect(policy.dirty).toBe(true);

    expect(policy.request("main")).toBe(true);
    expect(policy.request("quit")).toBe(true);
    expect(policy.confirm()).toBe("quit");
    expect(policy.dirty).toBe(false);
  });

  it("allows only trusted frontend navigation and external HTTP URLs", () => {
    const filePath = path.resolve("Frontend", "dist", "index.html");
    const trustedFileUrl = pathToFileURL(filePath);
    trustedFileUrl.searchParams.set("surface", "settings");

    expect(isTrustedDesktopNavigation(trustedFileUrl.toString(), { kind: "file", filePath })).toBe(true);
    expect(isTrustedDesktopNavigation("https://attacker.example/", { kind: "file", filePath })).toBe(false);
    expect(
      isTrustedDesktopNavigation("https://frontend.example/settings", {
        kind: "url",
        url: "https://frontend.example/",
      }),
    ).toBe(true);
    expect(resolveExternalHttpUrl("https://docs.example/path")).toBe("https://docs.example/path");
    expect(resolveExternalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(resolveExternalHttpUrl("file:///sensitive.txt")).toBeNull();
  });
});
