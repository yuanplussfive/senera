import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { pickNearest, useFluidHover } = await import("../../../Frontend/src/shared/motion/useFluidHover.ts");
const { FluidHoverHighlight } = await import("../../../Frontend/src/shared/motion/FluidHoverHighlight.tsx");

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id) => window.clearTimeout(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const baseInput = {
  containerRect: { left: 0, top: 0, width: 200, height: 120 },
  layoutSize: { width: 200, height: 120 },
  scroll: { x: 0, y: 0 },
  border: { x: 0, y: 0 },
};

test("fluid hover prefers the item under the pointer", () => {
  expect(
    pickNearest({
      ...baseInput,
      axis: "y",
      point: { x: 20, y: 42 },
      rects: [
        { top: 8, left: 0, width: 200, height: 24 },
        { top: 40, left: 0, width: 200, height: 24 },
      ],
    }),
  ).toBe(1);
});

test("fluid hover resolves gaps to the nearest item and skips disabled items", () => {
  expect(
    pickNearest({
      ...baseInput,
      axis: "y",
      point: { x: 20, y: 34 },
      rects: [
        { top: 8, left: 0, width: 200, height: 20 },
        { top: 44, left: 0, width: 200, height: 20 },
      ],
      isDisabled: (index) => index === 0,
    }),
  ).toBe(1);
});

test("fluid hover supports horizontal and grid nearest-item resolution", () => {
  expect(
    pickNearest({
      ...baseInput,
      axis: "x",
      point: { x: 142, y: 10 },
      rects: [
        { top: 0, left: 0, width: 80, height: 40 },
        { top: 0, left: 100, width: 80, height: 40 },
      ],
    }),
  ).toBe(1);
  expect(
    pickNearest({
      ...baseInput,
      axis: "xy",
      point: { x: 150, y: 90 },
      rects: [
        { top: 0, left: 0, width: 80, height: 40 },
        { top: 60, left: 100, width: 80, height: 40 },
      ],
    }),
  ).toBe(1);
});

test("containment-only lists light nothing while the pointer is off every item", () => {
  const rects = [
    { top: 8, left: 0, width: 200, height: 20 },
    { top: 44, left: 0, width: 200, height: 20 },
  ];

  // 34 falls in the gap between the two items. The default resolves it to a
  // neighbour; a list that opts into containment must report no active item so
  // the layer unmounts instead of lighting a row the pointer is nowhere near.
  const gap = { ...baseInput, axis: "y", point: { x: 20, y: 34 }, rects };
  expect(pickNearest(gap)).toBe(0);
  expect(pickNearest({ ...gap, requireContainment: true })).toBeNull();

  const inside = { ...baseInput, axis: "y", point: { x: 20, y: 50 }, rects };
  expect(pickNearest({ ...inside, requireContainment: true })).toBe(1);
});

function hoverRect(top, height) {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 200,
    top,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

let harnessRowRect = hoverRect(0, 40);

function HoverHarness() {
  const listRef = React.useRef(null);
  const hover = useFluidHover(listRef, { axis: "y", gapClick: false, requireContainment: true });
  return React.createElement(
    "div",
    { ref: listRef, className: "relative", ...hover.handlers },
    React.createElement("div", { ref: hover.getItemRef(0), "data-harness-row": "1" }),
    React.createElement(FluidHoverHighlight, { hover, transition: { duration: 0 } }),
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/**
 * StrictMode runs every effect's cleanup once on mount and then mounts again,
 * and that cleanup cancels the pending measurement frame. Cancelling without
 * releasing the id leaves the hook's "a frame is already pending" guard latched
 * for the whole session, so the list publishes rects once — on the first pointer
 * move — and then keeps painting them after the rows below have moved. A dock
 * does that on every expand, which is why it was the only list that looked
 * broken while static lists looked fine.
 */
test("a list keeps re-measuring after its layout changes, even under StrictMode", async () => {
  harnessRowRect = hoverRect(0, 40);
  const view = render(React.createElement(React.StrictMode, null, React.createElement(HoverHarness)));
  const list = view.container.firstElementChild;
  const row = view.container.querySelector("[data-harness-row]");
  vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => hoverRect(0, 200));
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => harnessRowRect);

  await settle();
  fireEvent.mouseMove(list, { clientY: 20 });
  await settle();
  expect(view.container.querySelector("[data-fluid-hover-highlight]")?.style.height).toBe("40px");

  harnessRowRect = hoverRect(0, 88);
  window.dispatchEvent(new Event("resize"));
  await settle();

  await waitFor(() => {
    expect(view.container.querySelector("[data-fluid-hover-highlight]")?.style.height).toBe("88px");
  });
});
