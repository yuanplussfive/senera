import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopWindowChrome, shouldUseCustomWindowControls } from "../../../Frontend/src/app/DesktopWindowChrome.tsx";
import {
  applyDesktopWindowDocumentState,
  clearDesktopWindowDocumentState,
} from "../../../Frontend/src/app/desktopWindowDocument.ts";
import {
  readWindowControlsInsetWidth,
  readWindowControlsOverlapWidth,
} from "../../../Frontend/src/shared/responsive/windowControlsLayout.ts";
import { Dialog, DialogContent } from "../../../Frontend/src/shared/ui/Dialog.tsx";

describe("desktop window chrome", () => {
  afterEach(() => {
    cleanup();
    clearDesktopWindowDocumentState();
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

  it("derives only the rendered window-control overlap for split surfaces", () => {
    const header = { left: 266, right: 1054, top: 0, bottom: 52 };
    const controls = { left: 922, right: 1060, top: 0, bottom: 52 };

    expect(readWindowControlsOverlapWidth({ containerRect: header, controlsRect: controls, gap: 12 })).toBe(144);
    expect(
      readWindowControlsOverlapWidth({
        containerRect: header,
        controlsRect: { left: 1100, right: 1238, top: 0, bottom: 52 },
        gap: 12,
      }),
    ).toBe(0);
    expect(
      readWindowControlsOverlapWidth({
        containerRect: header,
        controlsRect: { left: 922, right: 1060, top: 80, bottom: 132 },
        gap: 12,
      }),
    ).toBe(0);
  });

  it("renders custom controls only for custom-framed desktop windows", () => {
    expect(shouldUseCustomWindowControls("custom")).toBe(true);
    expect(shouldUseCustomWindowControls("native")).toBe(false);
    expect(shouldUseCustomWindowControls(undefined)).toBe(false);
  });

  it("publishes the document flags that reserve the desktop titlebar", () => {
    window.seneraDesktop = { isDesktop: true, windowControls: "custom" };
    applyDesktopWindowDocumentState("main");

    const root = document.documentElement;
    expect(root).toHaveAttribute("data-senera-desktop-window", "true");
    expect(root).toHaveAttribute("data-senera-window-controls", "custom");
    expect(root).toHaveAttribute("data-senera-desktop-surface", "main");

    applyDesktopWindowDocumentState("settings");
    expect(root).toHaveAttribute("data-senera-desktop-surface", "settings");

    window.seneraDesktop = { isDesktop: true, windowControls: "native" };
    applyDesktopWindowDocumentState("main");
    expect(root).toHaveAttribute("data-senera-window-controls", "native");
  });

  it("leaves web documents free of desktop frame flags", () => {
    applyDesktopWindowDocumentState("main");

    const root = document.documentElement;
    expect(root).not.toHaveAttribute("data-senera-desktop-window");
    expect(root).not.toHaveAttribute("data-senera-window-controls");
    expect(root).not.toHaveAttribute("data-senera-desktop-surface");
  });

  it("keeps the titlebar backdrop out of the window drag region", () => {
    window.seneraDesktop = {
      isDesktop: true,
      windowControls: "custom",
      getWindowState: vi.fn().mockResolvedValue({ isMaximized: false }),
    };

    render(React.createElement(DesktopWindowChrome, { surface: "main" }, null));

    // Electron derives draggable regions from layout boxes carrying the drag
    // attribute, even when the surface is visually transparent. Surface
    // headers own the real drag regions, so this backdrop layer must not
    // claim one or it swallows clicks across the whole titlebar.
    const strip = document.querySelector("[data-desktop-window-drag-strip]");
    expect(strip).not.toBeNull();
    expect(strip).not.toHaveAttribute("data-window-drag-region");
  });

  it("hands the reserved settings titlebar band to the drag region", () => {
    window.seneraDesktop = {
      isDesktop: true,
      windowControls: "custom",
      getWindowState: vi.fn().mockResolvedValue({ isMaximized: false }),
    };

    render(React.createElement(DesktopWindowChrome, { surface: "settings" }, null));

    // The settings surface reserves an empty 52px band above its columns and
    // renders no header of its own there, so the backdrop must be draggable or
    // the band cannot move the window.
    expect(document.querySelector("[data-desktop-window-drag-strip]")).toHaveAttribute("data-window-drag-region");
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

    expect(document.querySelector("[data-desktop-window-controls]")).toHaveClass("z-40", "text-content-muted");
    const maximizeButton = screen.getByRole("button", { name: "最大化窗口" });
    expect(maximizeButton.querySelector("svg")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-window-control] svg")).toHaveLength(3);
    for (const icon of document.querySelectorAll("[data-window-control] svg")) {
      expect(icon).toHaveClass("h-4", "w-4");
    }

    const closeButton = screen.getByRole("button", { name: "关闭窗口" });
    expect(closeButton).toHaveClass("hover:bg-ink-900/[0.055]", "hover:text-content-primary");
    expect(closeButton.className).not.toContain("#c42b1c");
  });

  it("paints all three window controls at one stroke weight", () => {
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

    const glyphs = [...document.querySelectorAll("[data-window-control] svg")];
    expect(glyphs.map((glyph) => glyph.getAttribute("data-window-control-glyph"))).toEqual([
      "minimize",
      "maximize",
      "close",
    ]);

    // Uneven stroke weight across these three is the defect this guards: one
    // shared width on one shared viewBox keeps the bar reading as one family.
    const strokes = new Set(glyphs.map((glyph) => glyph.getAttribute("stroke-width")));
    expect(strokes).toEqual(new Set(["1.5"]));
    expect(new Set(glyphs.map((glyph) => glyph.getAttribute("viewBox")))).toEqual(new Set(["0 0 24 24"]));
  });

  it("keeps custom controls below modal portal layers", () => {
    window.seneraDesktop = {
      isDesktop: true,
      windowControls: "custom",
      getWindowState: vi.fn().mockResolvedValue({ isMaximized: false }),
    };

    render(
      React.createElement(
        DesktopWindowChrome,
        { surface: "main" },
        React.createElement(
          Dialog,
          { open: true },
          React.createElement(DialogContent, { title: "模态窗口" }, React.createElement("p", null, "模态内容")),
        ),
      ),
    );

    expect(document.querySelector("[data-desktop-window-controls]")).toHaveClass("z-40");
    expect(document.querySelector(".fixed.inset-0")).toHaveClass("z-50");
    expect(screen.getByRole("dialog", { name: "模态窗口" })).toHaveClass("z-50");
  });
});
