import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopWindowChrome, shouldUseCustomWindowControls } from "../../../Frontend/src/app/DesktopWindowChrome.tsx";
import { readWindowControlsInsetWidth } from "../../../Frontend/src/shared/responsive/windowControlsLayout.ts";

describe("desktop window chrome", () => {
  afterEach(() => {
    cleanup();
    delete window.seneraDesktop;
  });

  it("retains the shared native-controls geometry fallback for web-capable surfaces", () => {
    expect(
      readWindowControlsInsetWidth({
        fallbackWidth: 138,
        overlay: {
          visible: true,
          getTitlebarAreaRect: () => ({ width: 1302, x: 0 }),
        },
        viewportWidth: 1440,
      }),
    ).toBe(138);
    expect(readWindowControlsInsetWidth({ fallbackWidth: 138, viewportWidth: 1440 })).toBe(138);
  });

  it("renders custom controls only for custom-framed desktop windows", () => {
    expect(shouldUseCustomWindowControls("custom")).toBe(true);
    expect(shouldUseCustomWindowControls("native")).toBe(false);
    expect(shouldUseCustomWindowControls(undefined)).toBe(false);
  });

  it("uses conventional square window-state icons", () => {
    window.seneraDesktop = {
      isDesktop: true,
      windowControls: "custom",
      getWindowState: vi.fn().mockResolvedValue({ isMaximized: false }),
    };

    render(
      React.createElement(
        DesktopWindowChrome,
        { surface: "main" },
        React.createElement("div", null, "Desktop content"),
      ),
    );

    expect(document.querySelector("[data-desktop-window-controls]")).toHaveClass("text-content-muted");
    const maximizeButton = screen.getByRole("button", { name: "最大化窗口" });
    expect(maximizeButton.querySelector(".lucide-square")).toBeInTheDocument();
    expect(maximizeButton.querySelector(".lucide-maximize-2")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-window-control] svg")).toHaveLength(3);
    for (const icon of document.querySelectorAll("[data-window-control] svg")) {
      expect(icon).toHaveClass("h-4", "w-4");
      expect(icon).toHaveAttribute("stroke-width", "2");
    }

    const closeButton = screen.getByRole("button", { name: "关闭窗口" });
    expect(closeButton).toHaveClass("hover:bg-ink-900/[0.055]", "hover:text-content-primary");
    expect(closeButton.className).not.toContain("#c42b1c");
  });
});
