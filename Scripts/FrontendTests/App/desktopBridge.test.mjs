import { describe, expect, it, vi } from "vitest";
import { openDesktopSettings, readDesktopBridge } from "../../../Frontend/src/app/desktopBridge.ts";

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
