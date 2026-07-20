import React, { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "../../../Frontend/src/shared/ui/Tooltip.tsx";
import { FloatingWorkbenchWindow } from "../../../Frontend/src/features/workbench/FloatingWorkbenchWindow.tsx";
import {
  clampWindowGeometry,
  createCollapsedWindowGeometry,
  createDefaultWindowGeometry,
  createMaximizedWindowGeometry,
  readPersistedWindowGeometry,
} from "../../../Frontend/src/features/workbench/windowGeometry.ts";

const policy = {
  inset: 12,
  compactInset: 0,
  defaultWidth: 760,
  defaultHeight: 460,
  defaultLeft: 64,
  defaultTop: 64,
  minWidth: 480,
  minHeight: 280,
  collapsedWidth: 360,
  titlebarHeight: 40,
  keyboardStep: 16,
};

afterEach(cleanup);

test("window geometry is clamped to the workbench without losing usable minimums", () => {
  expect(
    clampWindowGeometry({ x: 900, y: -20, width: 900, height: 900 }, { width: 1024, height: 768 }, policy),
  ).toEqual({
    x: 112,
    y: 12,
    width: 900,
    height: 744,
  });
  expect(clampWindowGeometry({ x: 20, y: 20, width: 760, height: 460 }, { width: 360, height: 240 }, policy)).toEqual({
    x: 12,
    y: 12,
    width: 336,
    height: 216,
  });
});

test("default, maximized, and collapsed geometry share one viewport policy", () => {
  const viewport = { width: 1440, height: 900 };
  const normal = createDefaultWindowGeometry(viewport, policy);
  expect(normal).toEqual({ x: 64, y: 64, width: 760, height: 460 });
  expect(createMaximizedWindowGeometry(viewport, policy, false)).toEqual({ x: 12, y: 12, width: 1416, height: 876 });
  expect(createMaximizedWindowGeometry(viewport, policy, true)).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  expect(createCollapsedWindowGeometry(normal, viewport, policy)).toEqual({ x: 64, y: 64, width: 360, height: 40 });
});

test("persisted geometry accepts only finite positive dimensions", () => {
  expect(readPersistedWindowGeometry({ x: 12, y: 24, width: 720, height: 440 })).toEqual({
    x: 12,
    y: 24,
    width: 720,
    height: 440,
  });
  expect(readPersistedWindowGeometry({ x: 0, y: 0, width: -1, height: 440 })).toBeUndefined();
  expect(readPersistedWindowGeometry({ x: Number.NaN, y: 0, width: 720, height: 440 })).toBeUndefined();
});

test("desktop window controls maximize and restore without replacing the window", () => {
  function Harness() {
    const [mode, setMode] = useState("normal");
    return React.createElement(
      TooltipProvider,
      { delayDuration: 0 },
      React.createElement(
        FloatingWorkbenchWindow,
        {
          open: true,
          compact: false,
          mode,
          title: "Terminal",
          geometry: { x: 64, y: 64, width: 640, height: 400 },
          geometryPolicy: policy,
          onClose: vi.fn(),
          onModeChange: setMode,
          onGeometryCommit: vi.fn(),
        },
        React.createElement("div", null, "Window content"),
      ),
    );
  }

  render(React.createElement(Harness));
  act(() => {
    screen.getByRole("button", { name: "最大化窗口" }).click();
  });
  expect(screen.getByRole("button", { name: "还原窗口" })).toBeEnabled();
  expect(screen.getByText("Window content")).toBeInTheDocument();
  act(() => {
    screen.getByRole("button", { name: "还原窗口" }).click();
  });
  expect(screen.getByRole("button", { name: "最大化窗口" })).toBeEnabled();
});
