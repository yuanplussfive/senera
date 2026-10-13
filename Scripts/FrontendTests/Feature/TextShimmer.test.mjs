import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderWithFrontendProviders } from "../renderWithFrontendProviders.mjs";

const { TextShimmer } = await import("../../../Frontend/src/shared/motion/textShimmer.tsx");
const { AppMotionProvider } = await import("../../../Frontend/src/shared/motion/MotionProvider.tsx");

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motionLevel;
});

test("sweeps the whole text on a single continuous element while active", () => {
  const view = renderWithFrontendProviders(
    React.createElement(TextShimmer, { text: "Plan\nInspect\nReport", active: true }),
  );

  const shimmering = view.container.querySelectorAll(".animate-text-shimmer");
  expect(shimmering).toHaveLength(1);
  expect(shimmering[0]).toHaveAttribute("data-text-shimmer", "true");
  expect(shimmering[0]).toHaveTextContent("Plan");
  expect(shimmering[0]).toHaveTextContent("Report");
});

test("renders plain text without the sweep when inactive", () => {
  const view = renderWithFrontendProviders(React.createElement(TextShimmer, { text: "Idle", active: false }));

  expect(view.container.querySelector("[data-text-shimmer]")).toBeNull();
  expect(view.container.querySelector(".animate-text-shimmer")).toBeNull();
  expect(view.container).toHaveTextContent("Idle");
});

test("disables the sweep for reduced motion", () => {
  const view = render(
    React.createElement(
      AppMotionProvider,
      { level: "reduced" },
      React.createElement(TextShimmer, { text: "One\nTwo", active: true }),
    ),
  );

  expect(view.container.querySelector("[data-text-shimmer]")).toBeNull();
  expect(view.container.querySelector(".animate-text-shimmer")).toBeNull();
});
