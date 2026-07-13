import { describe, expect, it, vi } from "vitest";
import {
  isMigratedSettingsSection,
  openDesktopSettingsOrFallback,
  openSettingsSurface,
} from "../../../Frontend/src/app/desktopBridge.ts";

describe("openDesktopSettingsOrFallback", () => {
  it("opens the first settings section when no target is specified", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn();

    await expect(
      openSettingsSurface({
        bridge: { isDesktop: true, openSettings },
        fallback,
      }),
    ).resolves.toBe("desktop");

    expect(openSettings).toHaveBeenCalledWith({ section: "model-service" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("opens the desktop settings window for migrated sections", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn();

    await expect(
      openDesktopSettingsOrFallback({
        bridge: { isDesktop: true, openSettings },
        fallback,
        section: "appearance",
      }),
    ).resolves.toBe("desktop");

    expect(openSettings).toHaveBeenCalledWith({ section: "appearance" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the fallback for legacy compatibility sections", async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn();

    await expect(
      openDesktopSettingsOrFallback({
        bridge: { isDesktop: true, openSettings },
        section: "tools",
        fallback,
      }),
    ).resolves.toBe("fallback");

    expect(openSettings).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("navigates web surfaces to migrated settings sections", async () => {
    const assign = vi.fn();
    const fallback = vi.fn();

    await expect(
      openSettingsSurface({
        bridge: undefined,
        fallback,
        location: { assign },
        section: "runtime",
      }),
    ).resolves.toBe("web");

    expect(assign).toHaveBeenCalledWith("?surface=settings&section=runtime");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the fallback when the desktop bridge fails", async () => {
    const fallback = vi.fn();

    await expect(
      openDesktopSettingsOrFallback({
        bridge: {
          isDesktop: true,
          openSettings: vi.fn().mockRejectedValue(new Error("ipc failed")),
        },
        fallback,
        section: "about",
      }),
    ).resolves.toBe("fallback");

    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("identifies the current migrated settings surface set", () => {
    expect(isMigratedSettingsSection("model-service")).toBe(true);
    expect(isMigratedSettingsSection("default-model")).toBe(true);
    expect(isMigratedSettingsSection("appearance")).toBe(true);
    expect(isMigratedSettingsSection("general")).toBe(true);
    expect(isMigratedSettingsSection("system")).toBe(true);
    expect(isMigratedSettingsSection("runtime")).toBe(true);
    expect(isMigratedSettingsSection("planning")).toBe(true);
    expect(isMigratedSettingsSection("retrieval")).toBe(true);
    expect(isMigratedSettingsSection("storage")).toBe(true);
    expect(isMigratedSettingsSection("skills")).toBe(true);
    expect(isMigratedSettingsSection("about")).toBe(true);
    expect(isMigratedSettingsSection("tools")).toBe(false);
  });

  it("does not treat retired providers/models IDs as migrated settings", () => {
    expect(isMigratedSettingsSection("providers")).toBe(false);
    expect(isMigratedSettingsSection("models")).toBe(false);
  });
});
